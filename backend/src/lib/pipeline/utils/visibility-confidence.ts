/**
 * Visibility Confidence Scoring & Gating
 *
 * Computes a deterministic, auditable confidence score for each anomaly
 * that controls its visibility state in the visualization. This is a
 * POST-ALIGNMENT, PRE-RENDER filter — no data is deleted.
 *
 * ───────────────────────────────────────────────────────────────────
 * Confidence Score Components (0–100):
 *
 *   1. Match Confidence (40%)  — from MatchedPair.confidence_score
 *      Matched features inherit their match score.
 *      Unmatched features receive 0.
 *
 *   2. Temporal Persistence (30%) — cross-run corroboration
 *      Seen in ≥2 runs → 100
 *      Seen in 1 run only → 0 (must rely on other factors)
 *
 *   3. Spatial Reinforcement (15%) — nearby features in same run
 *      Features near other anomalies/control points get a boost.
 *      Isolated features in sparse regions score lower.
 *
 *   4. Data Completeness (15%) — measurement quality
 *      How many dimensional fields (depth, length, width, clock)
 *      are populated. Sparse data = lower confidence.
 *
 * ───────────────────────────────────────────────────────────────────
 * Visibility States:
 *
 *   FULL     — score ≥ 70: fully rendered (default markers)
 *   DIMMED   — score 40–69: rendered at reduced opacity (0.25)
 *   HIDDEN   — score < 40: hidden by default, shown via toggle
 *
 * ───────────────────────────────────────────────────────────────────
 * Safeguards:
 *
 *   - Control points (welds, valves, tees, bends) are NEVER hidden
 *   - Baseline run features are NEVER hidden
 *   - No data is deleted — all features remain in the dataset
 *   - Every visibility decision includes an audit trail
 *   - Users can override via "Show Low-Confidence" toggle
 *
 * ───────────────────────────────────────────────────────────────────
 * Anti-patterns explicitly avoided:
 *
 *   ✗ Do NOT average away anomalies
 *   ✗ Do NOT assume newer runs are always correct
 *   ✗ Do NOT suppress without traceability
 *   ✗ Do NOT hardcode vendor-specific assumptions
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type VisibilityState = 'full' | 'dimmed' | 'hidden';

export type VisibilityAudit = {
  visibilityScore: number;
  visibilityState: VisibilityState;
  components: {
    matchConfidence: number;       // 0–100
    temporalPersistence: number;   // 0–100
    spatialReinforcement: number;  // 0–100
    dataCompleteness: number;      // 0–100
  };
  reasons: string[];
};

export type FeatureForVisibility = {
  id: string;
  type: string;
  distance: number;
  isReferencePoint: boolean;
  matchStatus: string;
  matchScore?: number | null;
  depthPercent?: number | null;
  depthIn?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  clockDecimal?: number | null;
};

export type VisibilityConfig = {
  fullThreshold: number;    // default 70
  dimmedThreshold: number;  // default 40
  weights: {
    matchConfidence: number;       // default 0.40
    temporalPersistence: number;   // default 0.30
    spatialReinforcement: number;  // default 0.15
    dataCompleteness: number;      // default 0.15
  };
};

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const CONTROL_POINT_TYPES = new Set([
  'GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'BEND', 'FIELD_BEND',
  'FLANGE', 'SUPPORT', 'LAUNCHER', 'RECEIVER', 'AGM'
]);

export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  fullThreshold: 70,
  dimmedThreshold: 40,
  weights: {
    matchConfidence: 0.40,
    temporalPersistence: 0.30,
    spatialReinforcement: 0.15,
    dataCompleteness: 0.15,
  },
};

// ──────────────────────────────────────────────────────────────────────
// Spatial Reinforcement
// ──────────────────────────────────────────────────────────────────────

/**
 * Computes spatial reinforcement for each feature based on how many
 * other features exist within a ±10 ft window in the same run.
 * Dense neighborhoods score 100; isolated features score 0.
 */
function computeSpatialReinforcement(
  features: FeatureForVisibility[],
  windowFt: number = 10
): Map<string, number> {
  const result = new Map<string, number>();

  // Sort by distance for efficient windowed counting
  const sorted = [...features].sort((a, b) => a.distance - b.distance);

  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    let neighbors = 0;

    // Count neighbors within window (look left)
    for (let j = i - 1; j >= 0; j--) {
      if (f.distance - sorted[j].distance > windowFt) break;
      neighbors++;
    }
    // Count neighbors within window (look right)
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].distance - f.distance > windowFt) break;
      neighbors++;
    }

    // Scale: 0 neighbors → 0, 1 → 40, 2 → 65, 3 → 80, 5+ → 100
    const score = Math.min(100, neighbors === 0 ? 0 : 20 + neighbors * 20);
    result.set(f.id, score);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Data Completeness
// ──────────────────────────────────────────────────────────────────────

/**
 * Scores how many dimensional measurement fields are populated.
 * Features with more complete data are higher confidence.
 */
function computeDataCompleteness(feature: FeatureForVisibility): number {
  const fields = [
    feature.depthPercent,
    feature.depthIn,
    feature.lengthIn,
    feature.widthIn,
    feature.clockDecimal,
  ];

  const populated = fields.filter((v) => v != null && Number.isFinite(v)).length;
  // 0/5 → 0, 1/5 → 20, 2/5 → 40, etc.
  return (populated / fields.length) * 100;
}

// ──────────────────────────────────────────────────────────────────────
// Temporal Persistence
// ──────────────────────────────────────────────────────────────────────

/**
 * Builds a map of feature ID → number of runs in which that feature
 * (or its matched partner chain) appears. Matched features are counted
 * as appearing in both runs.
 */
export function computeTemporalPersistence(
  allRuns: Array<{ features: FeatureForVisibility[] }>,
  matchPartnerMap: Map<string, string>
): Map<string, number> {
  // Build connected components of matched features
  const visited = new Set<string>();
  const componentRunCount = new Map<string, number>();

  // First pass: track which runs each feature appears in
  const featureToRunIndex = new Map<string, number>();
  for (let runIdx = 0; runIdx < allRuns.length; runIdx++) {
    for (const f of allRuns[runIdx].features) {
      featureToRunIndex.set(f.id, runIdx);
    }
  }

  // BFS to find connected components via match chain
  function getComponentRunCount(startId: string): number {
    const runsInComponent = new Set<number>();
    const queue = [startId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);

      const runIdx = featureToRunIndex.get(id);
      if (runIdx != null) runsInComponent.add(runIdx);

      const partnerId = matchPartnerMap.get(id);
      if (partnerId && !seen.has(partnerId)) {
        queue.push(partnerId);
      }
    }

    // Store count for all members
    const count = runsInComponent.size;
    for (const id of seen) {
      componentRunCount.set(id, count);
      visited.add(id);
    }

    return count;
  }

  // Process all features
  for (const run of allRuns) {
    for (const f of run.features) {
      if (!visited.has(f.id)) {
        getComponentRunCount(f.id);
      }
    }
  }

  return componentRunCount;
}

// ──────────────────────────────────────────────────────────────────────
// Main: Compute Visibility for All Features
// ──────────────────────────────────────────────────────────────────────

/**
 * Computes visibility audit for every feature across all runs.
 *
 * @param runs        Array of runs with their features
 * @param partnerMap  Feature ID → matched partner ID
 * @param totalRuns   Total number of runs in the dataset
 * @param baselineRunId  The ID of the baseline run
 * @param config      Visibility thresholds and weights
 * @returns Map of feature ID → VisibilityAudit
 */
export function computeVisibility(
  runs: Array<{ runId: string; isBaseline: boolean; features: FeatureForVisibility[] }>,
  partnerMap: Map<string, string>,
  totalRuns: number,
  baselineRunId: string,
  config: VisibilityConfig = DEFAULT_VISIBILITY_CONFIG
): Map<string, VisibilityAudit> {
  const result = new Map<string, VisibilityAudit>();

  // Pre-compute temporal persistence for all features
  const temporalMap = computeTemporalPersistence(runs, partnerMap);

  for (const run of runs) {
    // Pre-compute spatial reinforcement per run
    const spatialMap = computeSpatialReinforcement(run.features);

    for (const f of run.features) {
      const reasons: string[] = [];

      // ── Bypass: control points and baseline features are always FULL ──
      if (CONTROL_POINT_TYPES.has(f.type)) {
        result.set(f.id, {
          visibilityScore: 100,
          visibilityState: 'full',
          components: {
            matchConfidence: 100,
            temporalPersistence: 100,
            spatialReinforcement: 100,
            dataCompleteness: 100,
          },
          reasons: ['Control point: always fully visible'],
        });
        continue;
      }

      if (run.isBaseline) {
        result.set(f.id, {
          visibilityScore: 100,
          visibilityState: 'full',
          components: {
            matchConfidence: 100,
            temporalPersistence: 100,
            spatialReinforcement: 100,
            dataCompleteness: 100,
          },
          reasons: ['Baseline run: always fully visible'],
        });
        continue;
      }

      // ── Component 1: Match Confidence ──
      let matchConfidence = 0;
      if (f.matchStatus === 'matched' && f.matchScore != null) {
        matchConfidence = f.matchScore;
        if (matchConfidence >= 75) reasons.push('High-confidence match');
        else if (matchConfidence >= 50) reasons.push('Medium-confidence match');
        else reasons.push(`Low-confidence match (${matchConfidence.toFixed(0)}%)`);
      } else if (f.matchStatus === 'unlinked') {
        matchConfidence = 0;
        reasons.push('Unlinked: no match attempted');
      } else {
        matchConfidence = 0;
        reasons.push(`Unmatched (${f.matchStatus})`);
      }

      // ── Component 2: Temporal Persistence ──
      const runsAppearing = temporalMap.get(f.id) ?? 1;
      const temporalPersistence = runsAppearing >= 2
        ? Math.min(100, 50 + (runsAppearing / totalRuns) * 50)
        : 0;

      if (runsAppearing >= 2) {
        reasons.push(`Appears in ${runsAppearing}/${totalRuns} runs`);
      } else {
        reasons.push('Single-run anomaly: no cross-run corroboration');
      }

      // ── Component 3: Spatial Reinforcement ──
      const spatialReinforcement = spatialMap.get(f.id) ?? 0;
      if (spatialReinforcement === 0) {
        reasons.push('Spatially isolated (no neighbors within ±10 ft)');
      }

      // ── Component 4: Data Completeness ──
      const dataCompleteness = computeDataCompleteness(f);
      if (dataCompleteness < 40) {
        reasons.push('Sparse measurement data');
      }

      // ── Weighted Score ──
      const w = config.weights;
      const score =
        w.matchConfidence * matchConfidence +
        w.temporalPersistence * temporalPersistence +
        w.spatialReinforcement * spatialReinforcement +
        w.dataCompleteness * dataCompleteness;

      // ── State Decision ──
      let state: VisibilityState;
      if (score >= config.fullThreshold) {
        state = 'full';
      } else if (score >= config.dimmedThreshold) {
        state = 'dimmed';
        reasons.push(`Below full threshold (${score.toFixed(0)} < ${config.fullThreshold})`);
      } else {
        state = 'hidden';
        reasons.push(`Below visibility threshold (${score.toFixed(0)} < ${config.dimmedThreshold})`);
      }

      result.set(f.id, {
        visibilityScore: Math.round(score * 10) / 10,
        visibilityState: state,
        components: {
          matchConfidence: Math.round(matchConfidence * 10) / 10,
          temporalPersistence: Math.round(temporalPersistence * 10) / 10,
          spatialReinforcement: Math.round(spatialReinforcement * 10) / 10,
          dataCompleteness: Math.round(dataCompleteness * 10) / 10,
        },
        reasons,
      });
    }
  }

  return result;
}
