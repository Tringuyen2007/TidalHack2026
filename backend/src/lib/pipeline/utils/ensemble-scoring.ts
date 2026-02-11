/**
 * Ensemble Scoring Engine
 *
 * ───────────────────────────────────────────────────────────────────
 * Purpose:
 *
 *   We use ensemble scoring rather than a single heuristic to improve
 *   robustness. The matching confidence is a weighted ensemble of
 *   multiple independent evidence signals:
 *
 *     1. Distance similarity         (weight: 0.25)
 *     2. Clock similarity            (weight: 0.15, or 0 if missing)
 *     3. Dimensional similarity      (weight: 0.15)
 *     4. Feature-type compatibility  (weight: 0.15)
 *     5. DTW alignment confidence    (weight: 0.10)
 *     6. ICP residual                (weight: 0.10)
 *     7. Temporal persistence        (weight: 0.10)
 *
 * ───────────────────────────────────────────────────────────────────
 * Critical Properties:
 *
 *   - This is NOT ML training — weights are fixed, explainable, tunable
 *   - Every score component is individually logged for audit
 *   - Scores are deterministic given the same input
 *   - The ensemble supports future ML augmentation (weights could be
 *     learned from labeled ground truth, but aren't during hackathon)
 *   - Standards alignment: weights reflect API 1163 tool accuracy
 *     requirements and ASME B31.8S assessment priorities
 *
 * ───────────────────────────────────────────────────────────────────
 * References:
 *
 *   - API 1163 §5 — Tool performance specifications
 *   - ASME B31.8S §4 — Assessment methodology priorities
 *   - PHMSA 49 CFR 192.150 — Accuracy requirements
 */

import { clockCircularDistance } from './clock';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type EnsembleWeights = {
  distance: number;
  clock: number;
  dimensional: number;
  typeCompat: number;
  dtwConfidence: number;
  icpResidual: number;
  temporalPersistence: number;
};

export type EnsembleInput = {
  // ── Core feature comparison ──
  distanceResidualFt: number;
  olderClock: number | null | undefined;
  newerClock: number | null | undefined;
  olderType: string;
  newerType: string;
  olderDepthIn?: number | null;
  newerDepthIn?: number | null;
  olderLengthIn?: number | null;
  newerLengthIn?: number | null;
  olderWidthIn?: number | null;
  newerWidthIn?: number | null;

  // ── Algorithm-derived signals ──
  /** DTW confidence for the segment containing this pair (0–100) */
  dtwConfidence?: number | null;
  /** ICP RMSE for the segment containing this pair (ft) */
  icpRmse?: number | null;
  /** Number of runs where this anomaly was tracked (≥1) */
  temporalRunCount?: number | null;
  /** Total runs in the dataset */
  totalRunCount?: number | null;
};

export type EnsembleBreakdown = {
  /** Individual component scores (0–1 each) */
  distanceScore: number;
  clockScore: number;
  dimensionalScore: number;
  typeScore: number;
  dtwScore: number;
  icpScore: number;
  temporalScore: number;

  /** Weights applied to each component */
  weightsUsed: EnsembleWeights;

  /** Final weighted score (0–100) */
  total: number;

  /** Clock residual in hours (null if unavailable) */
  clockResidual: number | null;

  /** Confidence category */
  category: 'HIGH' | 'MEDIUM' | 'LOW';

  /** Human-readable explanation of the dominant factors */
  explanation: string;
};

// ──────────────────────────────────────────────────────────────────────
// Default Weights
// ──────────────────────────────────────────────────────────────────────

/**
 * Default ensemble weights.
 *
 * Rationale:
 *   - Distance is the most reliable signal per API 1163 (±0.5% odometer)
 *   - Clock is valuable but often missing or inconsistent between vendors
 *   - Dimensional similarity validates that the feature "looks the same"
 *   - Type compatibility is a strong binary/ternary signal
 *   - DTW confidence reflects how well the segment aligned
 *   - ICP residual shows local alignment quality
 *   - Temporal persistence rewards features tracked across multiple runs
 */
export const DEFAULT_WEIGHTS: EnsembleWeights = {
  distance: 0.25,
  clock: 0.15,
  dimensional: 0.15,
  typeCompat: 0.15,
  dtwConfidence: 0.10,
  icpResidual: 0.10,
  temporalPersistence: 0.10,
};

// ──────────────────────────────────────────────────────────────────────
// Type Compatibility Matrix
// ──────────────────────────────────────────────────────────────────────

const TYPE_COMPAT: Record<string, string[]> = {
  METAL_LOSS: ['CLUSTER', 'METAL_LOSS_MFG'],
  CLUSTER: ['METAL_LOSS', 'METAL_LOSS_MFG'],
  METAL_LOSS_MFG: ['METAL_LOSS', 'CLUSTER'],
  BEND: ['FIELD_BEND'],
  FIELD_BEND: ['BEND'],
  DENT: [],
  SEAM_WELD_MFG: [],
};

function typeCompatScore(a: string, b: string): number {
  if (a === b) return 1.0;
  if (TYPE_COMPAT[a]?.includes(b) || TYPE_COMPAT[b]?.includes(a)) return 0.7;
  return 0;
}

// ──────────────────────────────────────────────────────────────────────
// Component Score Functions
// ──────────────────────────────────────────────────────────────────────

function distanceScore(residualFt: number): number {
  // Exponential decay: 0 ft → 1.0, 1 ft → 0.72, 3 ft → 0.37, 10 ft → 0.05
  return Math.exp(-Math.abs(residualFt) / 3);
}

function clockScore(olderClock: number | null | undefined, newerClock: number | null | undefined): {
  score: number;
  residual: number | null;
  available: boolean;
} {
  const residual = clockCircularDistance(olderClock, newerClock);
  if (residual == null) return { score: 0, residual: null, available: false };
  // 0 hrs → 1.0, 0.5 hrs → 0.6, 1 hr → 0.37, 3 hrs → 0.05
  return { score: Math.exp(-residual / 1), residual, available: true };
}

function dimensionalScore(args: {
  olderDepthIn?: number | null;
  newerDepthIn?: number | null;
  olderLengthIn?: number | null;
  newerLengthIn?: number | null;
  olderWidthIn?: number | null;
  newerWidthIn?: number | null;
}): number {
  const components: number[] = [];

  // Depth similarity
  if (args.olderDepthIn != null && args.newerDepthIn != null) {
    const maxD = Math.max(args.olderDepthIn, args.newerDepthIn, 0.001);
    components.push(1 - Math.abs(args.newerDepthIn - args.olderDepthIn) / maxD);
  }

  // Length similarity
  if (args.olderLengthIn != null && args.newerLengthIn != null) {
    const maxL = Math.max(args.olderLengthIn, args.newerLengthIn, 0.001);
    components.push(1 - Math.abs(args.newerLengthIn - args.olderLengthIn) / maxL);
  }

  // Width similarity
  if (args.olderWidthIn != null && args.newerWidthIn != null) {
    const maxW = Math.max(args.olderWidthIn, args.newerWidthIn, 0.001);
    components.push(1 - Math.abs(args.newerWidthIn - args.olderWidthIn) / maxW);
  }

  if (components.length === 0) return 0.5; // No dimensional data → neutral
  return Math.max(0, components.reduce((s, c) => s + c, 0) / components.length);
}

function dtwScore(confidence: number | null | undefined): number {
  if (confidence == null) return 0.5; // Not available → neutral
  return Math.min(1, confidence / 100);
}

function icpScore(rmse: number | null | undefined): number {
  if (rmse == null) return 0.5; // Not available → neutral
  // 0 ft → 1.0, 1 ft → 0.72, 3 ft → 0.37
  return Math.exp(-rmse / 3);
}

function temporalScore(runCount: number | null | undefined, totalRuns: number | null | undefined): number {
  if (runCount == null || totalRuns == null || totalRuns <= 1) return 0.5;
  // Normalize: feature seen in all runs → 1.0, only 1 → 0.1
  return Math.min(1, 0.1 + 0.9 * ((runCount - 1) / (totalRuns - 1)));
}

// ──────────────────────────────────────────────────────────────────────
// Ensemble Calculator
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute the ensemble match confidence score.
 *
 * All components are scored independently on [0, 1], then combined
 * via weighted average. Missing signals (null) receive neutral scores
 * and their weight is redistributed proportionally.
 */
export function ensembleScore(
  input: EnsembleInput,
  weights: EnsembleWeights = DEFAULT_WEIGHTS,
): EnsembleBreakdown {
  const ds = distanceScore(input.distanceResidualFt);
  const cs = clockScore(input.olderClock, input.newerClock);
  const dim = dimensionalScore(input);
  const ts = typeCompatScore(input.olderType, input.newerType);
  const dtw = dtwScore(input.dtwConfidence);
  const icp = icpScore(input.icpRmse);
  const temp = temporalScore(input.temporalRunCount, input.totalRunCount);

  // Effective weights: if clock is missing, redistribute its weight
  const effectiveWeights = { ...weights };
  if (!cs.available) {
    const clockWt = effectiveWeights.clock;
    effectiveWeights.clock = 0;
    // Redistribute proportionally across other components
    const remaining = effectiveWeights.distance + effectiveWeights.dimensional
      + effectiveWeights.typeCompat + effectiveWeights.dtwConfidence
      + effectiveWeights.icpResidual + effectiveWeights.temporalPersistence;
    if (remaining > 0) {
      const scale = (remaining + clockWt) / remaining;
      effectiveWeights.distance *= scale;
      effectiveWeights.dimensional *= scale;
      effectiveWeights.typeCompat *= scale;
      effectiveWeights.dtwConfidence *= scale;
      effectiveWeights.icpResidual *= scale;
      effectiveWeights.temporalPersistence *= scale;
    }
  }

  const totalWeight = effectiveWeights.distance + effectiveWeights.clock
    + effectiveWeights.dimensional + effectiveWeights.typeCompat
    + effectiveWeights.dtwConfidence + effectiveWeights.icpResidual
    + effectiveWeights.temporalPersistence;

  const raw = (
    effectiveWeights.distance * ds +
    effectiveWeights.clock * cs.score +
    effectiveWeights.dimensional * dim +
    effectiveWeights.typeCompat * ts +
    effectiveWeights.dtwConfidence * dtw +
    effectiveWeights.icpResidual * icp +
    effectiveWeights.temporalPersistence * temp
  ) / (totalWeight || 1);

  const total = Math.round(raw * 10000) / 100; // 0–100 with 2 decimal places

  // Category
  const category: 'HIGH' | 'MEDIUM' | 'LOW' = total >= 75 ? 'HIGH' : total >= 50 ? 'MEDIUM' : 'LOW';

  // Build explanation: identify the 2 strongest and 2 weakest signals
  const signals = [
    { name: 'distance', score: ds, weight: effectiveWeights.distance },
    { name: 'clock', score: cs.score, weight: effectiveWeights.clock },
    { name: 'dimensional', score: dim, weight: effectiveWeights.dimensional },
    { name: 'type', score: ts, weight: effectiveWeights.typeCompat },
    { name: 'DTW', score: dtw, weight: effectiveWeights.dtwConfidence },
    { name: 'ICP', score: icp, weight: effectiveWeights.icpResidual },
    { name: 'temporal', score: temp, weight: effectiveWeights.temporalPersistence },
  ].filter(s => s.weight > 0);

  signals.sort((a, b) => b.score * b.weight - a.score * a.weight);
  const strongest = signals.slice(0, 2).map(s => `${s.name}(${(s.score * 100).toFixed(0)}%)`);
  const weakest = signals.slice(-2).map(s => `${s.name}(${(s.score * 100).toFixed(0)}%)`);

  const explanation = `${category}: strongest=${strongest.join('+')} weakest=${weakest.join('+')}`;

  return {
    distanceScore: ds,
    clockScore: cs.score,
    dimensionalScore: dim,
    typeScore: ts,
    dtwScore: dtw,
    icpScore: icp,
    temporalScore: temp,
    weightsUsed: effectiveWeights,
    total,
    clockResidual: cs.residual,
    category,
    explanation,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Backward-Compatible Wrapper
//
// Matches the existing `calculateScore()` signature so the pipeline
// can switch to ensemble scoring without interface changes.
// ──────────────────────────────────────────────────────────────────────

export type LegacyScoreBreakdown = {
  distanceScore: number;
  clockScore: number;
  typeScore: number;
  dimensionalScore: number;
  total: number;
  clockResidual: number | null;
  /** New: full ensemble breakdown for audit */
  ensemble?: EnsembleBreakdown;
};

/**
 * Drop-in replacement for the original `calculateScore()`.
 * Returns the same interface but internally uses the ensemble engine.
 * Extra algorithm-level signals (DTW, ICP, temporal) can be provided
 * for richer scoring.
 */
export function calculateEnsembleScore(args: {
  distanceResidualFt: number;
  olderClock: number | null | undefined;
  newerClock: number | null | undefined;
  olderType: string;
  newerType: string;
  olderDepthIn?: number | null;
  newerDepthIn?: number | null;
  olderLengthIn?: number | null;
  newerLengthIn?: number | null;
  olderWidthIn?: number | null;
  newerWidthIn?: number | null;
  dtwConfidence?: number | null;
  icpRmse?: number | null;
  temporalRunCount?: number | null;
  totalRunCount?: number | null;
}): LegacyScoreBreakdown {
  const breakdown = ensembleScore(args);

  return {
    distanceScore: breakdown.distanceScore,
    clockScore: breakdown.clockScore,
    typeScore: breakdown.typeScore,
    dimensionalScore: breakdown.dimensionalScore,
    total: breakdown.total,
    clockResidual: breakdown.clockResidual,
    ensemble: breakdown,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Ensemble Audit Record
// ──────────────────────────────────────────────────────────────────────

export type EnsembleAuditPayload = {
  algorithm: 'ENSEMBLE_SCORING';
  weightsUsed: EnsembleWeights;
  totalPairsScored: number;
  categoryDistribution: { HIGH: number; MEDIUM: number; LOW: number };
  avgScore: number;
  componentAvgs: {
    distance: number;
    clock: number;
    dimensional: number;
    type: number;
    dtw: number;
    icp: number;
    temporal: number;
  };
};

export function buildEnsembleAudit(
  breakdowns: EnsembleBreakdown[],
  weights: EnsembleWeights = DEFAULT_WEIGHTS,
): EnsembleAuditPayload {
  const n = breakdowns.length || 1;
  const dist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  let sumScore = 0;
  const sumComp = { distance: 0, clock: 0, dimensional: 0, type: 0, dtw: 0, icp: 0, temporal: 0 };

  for (const b of breakdowns) {
    dist[b.category]++;
    sumScore += b.total;
    sumComp.distance += b.distanceScore;
    sumComp.clock += b.clockScore;
    sumComp.dimensional += b.dimensionalScore;
    sumComp.type += b.typeScore;
    sumComp.dtw += b.dtwScore;
    sumComp.icp += b.icpScore;
    sumComp.temporal += b.temporalScore;
  }

  return {
    algorithm: 'ENSEMBLE_SCORING',
    weightsUsed: weights,
    totalPairsScored: breakdowns.length,
    categoryDistribution: dist,
    avgScore: sumScore / n,
    componentAvgs: {
      distance: sumComp.distance / n,
      clock: sumComp.clock / n,
      dimensional: sumComp.dimensional / n,
      type: sumComp.type / n,
      dtw: sumComp.dtw / n,
      icp: sumComp.icp / n,
      temporal: sumComp.temporal / n,
    },
  };
}
