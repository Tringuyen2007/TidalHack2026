/**
 * ML Sidecar Client — TypeScript MLProvider Implementation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Implements the MLProvider interface by calling the Python FastAPI
 * sidecar over HTTP. Includes:
 *
 *   - Health/readiness probing
 *   - Timeout & retry with exponential backoff
 *   - Graceful fallback to NoOpProvider on failure
 *   - Request batching for cluster predictions
 *   - Full audit logging of all ML inferences
 *
 * Configuration (environment variables):
 *   ML_SIDECAR_URL      — Base URL (default: http://localhost:8100)
 *   ML_SIDECAR_TIMEOUT  — Request timeout ms (default: 5000)
 *   ML_SIDECAR_RETRIES  — Max retries per request (default: 2)
 *   ENABLE_ML_SIDECAR   — 'true' to enable (default: 'false')
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

import type {
  MLProvider,
  FeaturePairVector,
  GrowthTrendVector,
  SubgraphVector,
  MLAugmentation,
} from './ml-hooks';

// ──────────────────────────────────────────────────────────────────────
// Types for Python sidecar API
// ──────────────────────────────────────────────────────────────────────

/** POST /predict/similarity request */
interface SimilarityRequest {
  older: {
    type: string;
    distance: number;
    clock: number | null;
    depth_percent: number | null;
    length_in: number | null;
    width_in: number | null;
  };
  newer: {
    type: string;
    distance: number;
    clock: number | null;
    depth_percent: number | null;
    length_in: number | null;
    width_in: number | null;
  };
  deterministic_score: number;
  distance_residual_ft: number;
  clock_residual_hrs: number | null;
}

/** POST /predict/similarity response */
interface SimilarityResponse {
  ml_similarity_score: number;
  ml_confidence: number;
  adjusted_score: number;
  explanation: string;
  model_id: string;
  model_version: string;
  experimental: boolean;
}

/** POST /predict/growth request */
interface GrowthApiRequest {
  feature_id: string;
  depth_history: { run_date: string; depth_percent: number }[];
  distance_history: { run_date: string; distance_ft: number }[];
  linear_growth_rate: number;
}

/** POST /predict/growth response */
interface GrowthApiResponse {
  prediction: {
    predicted_rate_pct_yr: number;
    lower_bound_pct_yr: number;
    upper_bound_pct_yr: number;
    uncertainty: number;
    trend_class: string;
    acceleration_pct_yr2: number;
    remaining_life_years: number | null;
    r_squared: number;
  };
  ml_confidence: number;
  explanation: string;
  model_id: string;
  model_version: string;
  experimental: boolean;
}

/** POST /predict/clusters request */
export interface ClusterFeatureInput {
  feature_id: string;
  corrected_distance_ft: number;
  clock_hrs: number | null;
  depth_percent: number | null;
  length_in: number | null;
  width_in: number | null;
  event_type: string;
}

/** POST /predict/clusters response */
export interface ClusterApiResponse {
  labels: { feature_id: string; cluster_id: number; distance_to_centroid: number }[];
  clusters: {
    cluster_id: number;
    member_count: number;
    centroid_distance_ft: number;
    centroid_clock_hrs: number | null;
    spread_distance_ft: number;
    spread_clock_hrs: number | null;
    dominant_type: string;
    risk_density: number;
  }[];
  noise_count: number;
  total_clusters: number;
  model_id: string;
  model_version: string;
  experimental: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// ML Sidecar Client
// ──────────────────────────────────────────────────────────────────────

export class MLSidecarClient implements MLProvider {
  name = 'ml-sidecar';

  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private _healthy = false;
  private _lastHealthCheck = 0;
  private _healthCheckIntervalMs = 30_000; // re-check every 30s

  constructor(opts?: {
    baseUrl?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    this.baseUrl = opts?.baseUrl
      ?? process.env.ML_SIDECAR_URL
      ?? 'http://localhost:8100';
    this.timeoutMs = opts?.timeoutMs
      ?? parseInt(process.env.ML_SIDECAR_TIMEOUT ?? '5000', 10);
    this.maxRetries = opts?.maxRetries
      ?? parseInt(process.env.ML_SIDECAR_RETRIES ?? '2', 10);
  }

  // ────────────────────────────────────────────────────────────────
  // HTTP helpers
  // ────────────────────────────────────────────────────────────────

  private async fetchWithTimeout(
    url: string,
    body: unknown,
    retries = this.maxRetries
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`ML sidecar ${url} returned ${response.status}`);
        }

        return response;
      } catch (err) {
        lastError = err as Error;
        if (attempt < retries) {
          // Exponential backoff: 200ms, 400ms, 800ms...
          const delay = 200 * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError ?? new Error(`ML sidecar request to ${url} failed`);
  }

  // ────────────────────────────────────────────────────────────────
  // Health & Readiness
  // ────────────────────────────────────────────────────────────────

  async isReady(): Promise<boolean> {
    const now = Date.now();

    // Cache health check result for 30s
    if (now - this._lastHealthCheck < this._healthCheckIntervalMs) {
      return this._healthy;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.baseUrl}/ready`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        this._healthy = data.ready === true;
      } else {
        this._healthy = false;
      }
    } catch {
      this._healthy = false;
    }

    this._lastHealthCheck = now;
    return this._healthy;
  }

  // ────────────────────────────────────────────────────────────────
  // MLProvider Interface
  // ────────────────────────────────────────────────────────────────

  async scoreFeaturePair(pair: FeaturePairVector): Promise<MLAugmentation> {
    const reqBody: SimilarityRequest = {
      older: {
        type: pair.older.type,
        distance: pair.older.distance,
        clock: pair.older.clock,
        depth_percent: pair.older.depthPercent,
        length_in: pair.older.lengthIn,
        width_in: pair.older.widthIn,
      },
      newer: {
        type: pair.newer.type,
        distance: pair.newer.distance,
        clock: pair.newer.clock,
        depth_percent: pair.newer.depthPercent,
        length_in: pair.newer.lengthIn,
        width_in: pair.newer.widthIn,
      },
      deterministic_score: pair.deterministicScore,
      distance_residual_ft: pair.distanceResidualFt,
      clock_residual_hrs: pair.clockResidualHrs,
    };

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/predict/similarity`,
      reqBody,
    );
    const data: SimilarityResponse = await res.json();

    // Apply the formula: final = det * 0.8 + ml * 0.2
    const blended = pair.deterministicScore * 0.8 + (data.ml_similarity_score * 100) * 0.2;

    return {
      adjustedScore: Math.max(0, Math.min(100, blended)),
      mlConfidence: data.ml_confidence,
      explanation: `[EXPERIMENTAL] ${data.explanation}`,
      modelId: data.model_id,
      modelVersion: data.model_version,
    };
  }

  async assessGrowthTrend(trend: GrowthTrendVector): Promise<MLAugmentation> {
    const reqBody: GrowthApiRequest = {
      feature_id: trend.featureId,
      depth_history: trend.depthHistory.map(d => ({
        run_date: d.runDate.toISOString(),
        depth_percent: d.depthPercent,
      })),
      distance_history: trend.distanceHistory.map(d => ({
        run_date: d.runDate.toISOString(),
        distance_ft: d.distanceFt,
      })),
      linear_growth_rate: trend.linearGrowthRate,
    };

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/predict/growth`,
      reqBody,
    );
    const data: GrowthApiResponse = await res.json();

    return {
      adjustedScore: data.prediction.predicted_rate_pct_yr,
      mlConfidence: data.ml_confidence,
      explanation: `[EXPERIMENTAL] ${data.explanation}`,
      modelId: data.model_id,
      modelVersion: data.model_version,
    };
  }

  async scoreInteractionSubgraph(subgraph: SubgraphVector): Promise<MLAugmentation> {
    // Map subgraph nodes to cluster features for the DBSCAN endpoint
    const features: ClusterFeatureInput[] = subgraph.nodeFeatures.map((nf, i) => ({
      feature_id: `node-${i}`,
      corrected_distance_ft: nf[0] ?? 0,
      clock_hrs: nf[1] ?? null,
      depth_percent: nf[2] ?? null,
      length_in: nf[3] ?? null,
      width_in: nf[4] ?? null,
      event_type: 'UNKNOWN',
    }));

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/predict/clusters`,
      { features, eps: 5.0, min_samples: 2 },
    );
    const data: ClusterApiResponse = await res.json();

    // Use cluster density as a risk adjustment
    const maxDensity = Math.max(...data.clusters.map(c => c.risk_density), 0.1);
    const densityScore = Math.min(maxDensity * 10, 100); // scale to 0-100

    // Blend: cluster analysis augments the deterministic interaction score
    const blended = subgraph.deterministicInteractionScore * 0.8 + densityScore * 0.2;

    return {
      adjustedScore: Math.max(0, Math.min(100, blended)),
      mlConfidence: data.total_clusters > 0 ? 0.6 : 0.2,
      explanation: `[EXPERIMENTAL] DBSCAN found ${data.total_clusters} clusters, ${data.noise_count} noise points. Max density=${maxDensity.toFixed(2)} features/ft.`,
      modelId: data.model_id ?? 'dbscan-clustering',
      modelVersion: data.model_version ?? '0.1.0',
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Direct API access (for pipeline-level calls)
  // ────────────────────────────────────────────────────────────────

  /**
   * Direct cluster prediction — used by pipeline for batch
   * clustering of all features (not through MLProvider interface).
   */
  async predictClusters(
    features: ClusterFeatureInput[],
    eps = 5.0,
    minSamples = 2,
  ): Promise<ClusterApiResponse> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/predict/clusters`,
      { features, eps, min_samples: minSamples },
    );
    return res.json();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Factory: create & register the sidecar client if enabled
// ──────────────────────────────────────────────────────────────────────

import { setMLProvider, resetMLProvider } from './ml-hooks';

/**
 * Initialize the ML sidecar if ENABLE_ML_SIDECAR=true.
 * Call this once at pipeline startup.
 *
 * Returns the client for direct API access (e.g., cluster batching)
 * or null if ML is disabled.
 */
export async function initMLSidecar(overrideEnabled?: boolean): Promise<MLSidecarClient | null> {
  const enabled = overrideEnabled ?? process.env.ENABLE_ML_SIDECAR === 'true';

  if (!enabled) {
    console.log('[ML-CLIENT] ML sidecar disabled (enable_ml=false)');
    resetMLProvider();
    return null;
  }

  const client = new MLSidecarClient();
  const ready = await client.isReady();

  if (ready) {
    setMLProvider(client);
    console.log('[ML-CLIENT] ML sidecar connected and registered');
    return client;
  } else {
    console.warn('[ML-CLIENT] ML sidecar not reachable — falling back to no-op');
    resetMLProvider();
    return null;
  }
}
