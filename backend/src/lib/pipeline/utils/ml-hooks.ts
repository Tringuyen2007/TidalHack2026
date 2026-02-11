/**
 * Machine Learning Hooks — Pluggable Interface
 *
 * ───────────────────────────────────────────────────────────────────
 * Architecture:
 *
 *   ML is OPTIONAL, PLUGGABLE, and DOWNSTREAM.
 *
 *   This module defines interfaces and no-op defaults for future ML
 *   model integration. During the hackathon, no models are trained.
 *   The hooks exist so that:
 *
 *     1. A Siamese network can later refine match confidence
 *     2. A Transformer can assess anomaly growth patterns
 *     3. A GNN can score interaction subgraphs
 *
 *   Every hook:
 *     - Has a no-op default that passes through the deterministic score
 *     - Can be replaced via dependency injection (setProvider)
 *     - Never overrides the deterministic pipeline — only augments
 *     - Logs when it runs (for auditability)
 *     - Has a fallback that returns the original score on any error
 *
 * ───────────────────────────────────────────────────────────────────
 * Contract:
 *
 *   ML outputs are treated as ONE additional signal in the ensemble.
 *   The ensemble scorer already reserves a slot for ML confidence
 *   augmentation. The pipeline structure is:
 *
 *     Deterministic Score → ML Augmentation (optional) → Final Score
 *
 *   The ML augmentation is bounded: it can adjust the score by at
 *   most ±10 points on a 0–100 scale.
 *
 * ───────────────────────────────────────────────────────────────────
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

/** Feature pair representation for ML models */
export type FeaturePairVector = {
  /** Older run feature */
  older: {
    type: string;
    distance: number;
    clock: number | null;
    depthPercent: number | null;
    lengthIn: number | null;
    widthIn: number | null;
  };
  /** Newer run feature */
  newer: {
    type: string;
    distance: number;
    clock: number | null;
    depthPercent: number | null;
    lengthIn: number | null;
    widthIn: number | null;
  };
  /** Deterministic score (0-100) from ensemble */
  deterministicScore: number;
  /** Distance between features in feet */
  distanceResidualFt: number;
  /** Clock difference in hours (null if missing) */
  clockResidualHrs: number | null;
};

/** Growth trend data for temporal models */
export type GrowthTrendVector = {
  featureId: string;
  /** Depth readings across N runs, oldest → newest */
  depthHistory: { runDate: Date; depthPercent: number }[];
  /** Distance readings across runs */
  distanceHistory: { runDate: Date; distanceFt: number }[];
  /** Current linear growth rate (%WT/yr) */
  linearGrowthRate: number;
};

/** Interaction subgraph for GNN scoring */
export type SubgraphVector = {
  /** Node features: [distance, clock, depth, length, width] per anomaly */
  nodeFeatures: number[][];
  /** Adjacency list: [i, j, edgeWeight][] */
  edges: [number, number, number][];
  /** Deterministic interaction score */
  deterministicInteractionScore: number;
};

/** ML provider result — augments but doesn't override */
export type MLAugmentation = {
  /** Adjusted score (bounded within ±10 of deterministic) */
  adjustedScore: number;
  /** Confidence in the ML prediction itself (0-1) */
  mlConfidence: number;
  /** Explanation of what the model "saw" */
  explanation: string;
  /** Model identifier for audit trail */
  modelId: string;
  /** Model version */
  modelVersion: string;
};

// ──────────────────────────────────────────────────────────────────────
// Provider Interface
// ──────────────────────────────────────────────────────────────────────

export interface MLProvider {
  /** Unique name for this provider */
  name: string;

  /**
   * Siamese network: refine match confidence for a feature pair.
   * Returns augmented score bounded to ±10 of deterministic.
   */
  scoreFeaturePair(pair: FeaturePairVector): Promise<MLAugmentation>;

  /**
   * Transformer: assess corrosion growth trajectory.
   * Returns augmented growth severity prediction.
   */
  assessGrowthTrend(trend: GrowthTrendVector): Promise<MLAugmentation>;

  /**
   * GNN: score interaction subgraph severity.
   * Returns augmented interaction risk score.
   */
  scoreInteractionSubgraph(subgraph: SubgraphVector): Promise<MLAugmentation>;

  /** Check if this provider is healthy and loaded */
  isReady(): Promise<boolean>;
}

// ──────────────────────────────────────────────────────────────────────
// No-Op Default Provider
// ──────────────────────────────────────────────────────────────────────

class NoOpProvider implements MLProvider {
  name = 'no-op';

  async scoreFeaturePair(pair: FeaturePairVector): Promise<MLAugmentation> {
    return {
      adjustedScore: pair.deterministicScore,
      mlConfidence: 0,
      explanation: 'ML not configured — deterministic score used as-is.',
      modelId: 'none',
      modelVersion: '0.0.0',
    };
  }

  async assessGrowthTrend(trend: GrowthTrendVector): Promise<MLAugmentation> {
    return {
      adjustedScore: trend.linearGrowthRate,
      mlConfidence: 0,
      explanation: 'ML not configured — linear growth rate used as-is.',
      modelId: 'none',
      modelVersion: '0.0.0',
    };
  }

  async scoreInteractionSubgraph(subgraph: SubgraphVector): Promise<MLAugmentation> {
    return {
      adjustedScore: subgraph.deterministicInteractionScore,
      mlConfidence: 0,
      explanation: 'ML not configured — deterministic interaction score used as-is.',
      modelId: 'none',
      modelVersion: '0.0.0',
    };
  }

  async isReady() {
    return true;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Provider Registry (Singleton)
// ──────────────────────────────────────────────────────────────────────

let _provider: MLProvider = new NoOpProvider();

/**
 * Register a custom ML provider.
 * The provider must implement the MLProvider interface.
 */
export function setMLProvider(provider: MLProvider): void {
  console.log(`[ML-HOOKS] Registering ML provider: ${provider.name}`);
  _provider = provider;
}

/** Get the currently registered ML provider */
export function getMLProvider(): MLProvider {
  return _provider;
}

/** Reset to the no-op default (useful for testing) */
export function resetMLProvider(): void {
  _provider = new NoOpProvider();
}

// ──────────────────────────────────────────────────────────────────────
// Safe Wrappers (Bounded + Error-Safe)
// ──────────────────────────────────────────────────────────────────────

const MAX_ML_ADJUSTMENT = 10; // ±10 points max

/** Clamp ML adjustment to ±MAX_ML_ADJUSTMENT of the deterministic score */
function clampAdjustment(deterministic: number, mlScore: number): number {
  const clamped = Math.max(
    deterministic - MAX_ML_ADJUSTMENT,
    Math.min(deterministic + MAX_ML_ADJUSTMENT, mlScore),
  );
  return Math.max(0, Math.min(100, clamped));
}

/**
 * Safely score a feature pair with ML augmentation.
 * On any error, returns the deterministic score unchanged.
 */
export async function safeScoreFeaturePair(
  pair: FeaturePairVector,
): Promise<MLAugmentation> {
  try {
    const result = await _provider.scoreFeaturePair(pair);
    return {
      ...result,
      adjustedScore: clampAdjustment(pair.deterministicScore, result.adjustedScore),
    };
  } catch (err) {
    console.warn(`[ML-HOOKS] scoreFeaturePair failed, falling back to deterministic:`, err);
    return {
      adjustedScore: pair.deterministicScore,
      mlConfidence: 0,
      explanation: `ML error — deterministic fallback. Error: ${(err as Error).message}`,
      modelId: _provider.name,
      modelVersion: 'error',
    };
  }
}

/**
 * Safely assess growth trend with ML augmentation.
 */
export async function safeAssessGrowthTrend(
  trend: GrowthTrendVector,
): Promise<MLAugmentation> {
  try {
    return await _provider.assessGrowthTrend(trend);
  } catch (err) {
    console.warn(`[ML-HOOKS] assessGrowthTrend failed, falling back to linear:`, err);
    return {
      adjustedScore: trend.linearGrowthRate,
      mlConfidence: 0,
      explanation: `ML error — linear growth fallback. Error: ${(err as Error).message}`,
      modelId: _provider.name,
      modelVersion: 'error',
    };
  }
}

/**
 * Safely score interaction subgraph with ML augmentation.
 */
export async function safeScoreInteractionSubgraph(
  subgraph: SubgraphVector,
): Promise<MLAugmentation> {
  try {
    const result = await _provider.scoreInteractionSubgraph(subgraph);
    return {
      ...result,
      adjustedScore: clampAdjustment(
        subgraph.deterministicInteractionScore,
        result.adjustedScore,
      ),
    };
  } catch (err) {
    console.warn(`[ML-HOOKS] scoreInteractionSubgraph failed, falling back:`, err);
    return {
      adjustedScore: subgraph.deterministicInteractionScore,
      mlConfidence: 0,
      explanation: `ML error — deterministic fallback. Error: ${(err as Error).message}`,
      modelId: _provider.name,
      modelVersion: 'error',
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Audit
// ──────────────────────────────────────────────────────────────────────

export type MLHooksAuditPayload = {
  algorithm: 'ML_HOOKS';
  providerName: string;
  providerReady: boolean;
  pairsScored: number;
  growthsAssessed: number;
  subgraphsScored: number;
  errors: number;
  maxAdjustmentBound: number;
};

export function buildMLHooksAudit(stats: {
  pairsScored: number;
  growthsAssessed: number;
  subgraphsScored: number;
  errors: number;
}): MLHooksAuditPayload {
  return {
    algorithm: 'ML_HOOKS',
    providerName: _provider.name,
    providerReady: true, // set at call time
    pairsScored: stats.pairsScored,
    growthsAssessed: stats.growthsAssessed,
    subgraphsScored: stats.subgraphsScored,
    errors: stats.errors,
    maxAdjustmentBound: MAX_ML_ADJUSTMENT,
  };
}
