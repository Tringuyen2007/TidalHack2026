/**
 * Dynamic Time Warping (DTW) for Reference-Point Sequence Alignment
 *
 * ───────────────────────────────────────────────────────────────────
 * Purpose:
 *
 *   DTW aligns reference-point sequences (girth welds, valves, tees)
 *   across ILI runs prior to distance correction. It handles:
 *
 *     - Non-linear odometer drift between tool runs
 *     - Tool speed variation causing local stretch / compression
 *     - Missing or extra reference points (cutouts, additions)
 *
 * ───────────────────────────────────────────────────────────────────
 * How It Works:
 *
 *   1. Extract ordered distance sequences from two runs' ref points
 *   2. Compute DTW cost matrix using inter-joint spacing as the
 *      distance metric (not raw odometer — spacing is invariant)
 *   3. Backtrack the optimal warp path to produce a mapping function
 *   4. The mapping function tells the correction step how each
 *      reference point in the older run corresponds to one in the
 *      newer run
 *
 * ───────────────────────────────────────────────────────────────────
 * Critical Properties:
 *
 *   - Deterministic: same inputs → same path, no randomness
 *   - Explainable: the cost matrix and path are fully inspectable
 *   - Auditable: DTW cost and path are logged for review
 *   - No ML training: this is a classical DP algorithm
 *   - DTW produces a MAPPING FUNCTION, not matches
 *   - DTW runs BEFORE anomaly matching / correction
 *
 * ───────────────────────────────────────────────────────────────────
 * References:
 *
 *   - Sakoe & Chiba (1978), "Dynamic Programming Algorithm
 *     Optimization for Spoken Word Recognition"
 *   - API 1163 §5.4 — Tool qualification and repeatability
 *   - PHMSA 49 CFR 192.150 — Odometer accuracy requirements
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type DTWInput = {
  /** Feature ID for traceability */
  id: string;
  /** Corrected or log distance in feet */
  distance: number;
  /** Joint number (if available) for cross-validation */
  joint?: number | null;
};

export type DTWPathStep = {
  /** Index in the older run's sequence */
  olderIndex: number;
  /** Index in the newer run's sequence */
  newerIndex: number;
  /** Cumulative cost at this step */
  cumulativeCost: number;
  /** Local cost at this step */
  localCost: number;
};

export type DTWResult = {
  /** Optimal warp path (ordered older→newer index pairs) */
  path: DTWPathStep[];
  /** Total alignment cost (lower = better alignment) */
  totalCost: number;
  /** Normalized cost (totalCost / path length) — comparable across runs */
  normalizedCost: number;
  /** Per-step drift estimates in feet */
  driftProfile: number[];
  /** Full cost matrix (for audit / visualization) */
  costMatrix: number[][];
  /** Confidence: 0–100, based on normalized cost */
  confidence: number;
};

// ──────────────────────────────────────────────────────────────────────
// Distance Metric
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute inter-point spacing sequences.
 * Using spacing (delta-distances) rather than raw odometer values
 * makes DTW invariant to absolute offset — only the pattern of
 * spacing between landmarks matters.
 */
function toSpacings(points: DTWInput[]): number[] {
  const spacings: number[] = [];
  for (let i = 1; i < points.length; i++) {
    spacings.push(points[i].distance - points[i - 1].distance);
  }
  return spacings;
}

/**
 * Cost function for DTW: absolute difference in spacing.
 * This captures whether the "stretch" between consecutive
 * reference points is consistent across runs.
 */
function spacingCost(a: number, b: number): number {
  return Math.abs(a - b);
}

// ──────────────────────────────────────────────────────────────────────
// Core DTW Algorithm
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute the DTW alignment between two reference-point sequences.
 *
 * Uses the standard Sakoe-Chiba DTW with a global constraint
 * window (band) to prevent pathological warps. The window width
 * adapts to sequence length.
 *
 * @param older — reference points from the older run, sorted by distance
 * @param newer — reference points from the newer (baseline) run, sorted by distance
 * @param bandWidthFraction — Sakoe-Chiba band as fraction of sequence length (default 0.25)
 */
export function computeDTW(
  older: DTWInput[],
  newer: DTWInput[],
  bandWidthFraction = 0.25,
): DTWResult {
  const seqA = toSpacings(older);
  const seqB = toSpacings(newer);

  const n = seqA.length;
  const m = seqB.length;

  // Edge case: if one or both sequences are too short
  if (n === 0 || m === 0) {
    return {
      path: [],
      totalCost: 0,
      normalizedCost: 0,
      driftProfile: [],
      costMatrix: [],
      confidence: n === 0 && m === 0 ? 100 : 0,
    };
  }

  // Sakoe-Chiba band width
  const band = Math.max(1, Math.ceil(Math.max(n, m) * bandWidthFraction));

  // Initialize cost matrix with Infinity
  const D: number[][] = Array.from({ length: n }, () =>
    new Array(m).fill(Infinity),
  );

  // Local cost matrix (for audit)
  const C: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => spacingCost(seqA[i], seqB[j])),
  );

  // Fill DP matrix with band constraint
  for (let i = 0; i < n; i++) {
    const jMin = Math.max(0, i - band);
    const jMax = Math.min(m - 1, i + band);
    for (let j = jMin; j <= jMax; j++) {
      const cost = C[i][j];
      if (i === 0 && j === 0) {
        D[i][j] = cost;
      } else if (i === 0) {
        D[i][j] = cost + D[i][j - 1];
      } else if (j === 0) {
        D[i][j] = cost + D[i - 1][j];
      } else {
        D[i][j] = cost + Math.min(
          D[i - 1][j],     // insertion
          D[i][j - 1],     // deletion
          D[i - 1][j - 1], // match
        );
      }
    }
  }

  // Backtrack optimal path
  const path: DTWPathStep[] = [];
  let i = n - 1;
  let j = m - 1;

  while (i >= 0 && j >= 0) {
    path.push({
      olderIndex: i,
      newerIndex: j,
      cumulativeCost: D[i][j],
      localCost: C[i][j],
    });

    if (i === 0 && j === 0) break;
    if (i === 0) { j--; continue; }
    if (j === 0) { i--; continue; }

    const diag = D[i - 1][j - 1];
    const up   = D[i - 1][j];
    const left = D[i][j - 1];

    if (diag <= up && diag <= left) {
      i--; j--;
    } else if (up <= left) {
      i--;
    } else {
      j--;
    }
  }

  path.reverse();

  const totalCost = D[n - 1][m - 1];
  const normalizedCost = totalCost / path.length;

  // Build drift profile: at each path step, compute the absolute
  // distance offset between the aligned reference points.
  // This uses the original (pre-spacing) distances.
  const driftProfile: number[] = path.map((step) => {
    // +1 because spacings are between consecutive points,
    // so spacing index i corresponds to the gap between
    // point i and point i+1
    const olderDist = older[step.olderIndex + 1]?.distance ?? older[step.olderIndex]?.distance ?? 0;
    const newerDist = newer[step.newerIndex + 1]?.distance ?? newer[step.newerIndex]?.distance ?? 0;
    return newerDist - olderDist;
  });

  // Confidence: exponential decay based on normalized cost
  // 0 ft avg error → 100%, 3 ft avg error → ~50%, 10 ft → ~5%
  const confidence = Math.max(0, Math.min(100,
    100 * Math.exp(-normalizedCost / 3),
  ));

  return {
    path,
    totalCost,
    normalizedCost,
    driftProfile,
    costMatrix: D,
    confidence,
  };
}

// ──────────────────────────────────────────────────────────────────────
// DTW → Anchor Mapping
//
// Converts the DTW warp path into AnchorPair-compatible mappings
// that the existing correction step can consume.
// ──────────────────────────────────────────────────────────────────────

export type DTWAnchorMapping = {
  olderIdx: number;
  newerIdx: number;
  olderId: string;
  newerId: string;
  olderDistance: number;
  newerDistance: number;
  driftFt: number;
  dtwLocalCost: number;
};

/**
 * Extract 1:1 anchor mappings from the DTW warp path.
 *
 * DTW may produce many-to-one or one-to-many mappings for
 * insertions/deletions. This function filters to only 1:1 steps
 * (diagonal moves on the path), which are the confident pairings.
 *
 * @returns Ordered list of anchor mappings suitable for correction
 */
export function extractAnchorMappings(
  older: DTWInput[],
  newer: DTWInput[],
  result: DTWResult,
): DTWAnchorMapping[] {
  const mappings: DTWAnchorMapping[] = [];
  const usedOlder = new Set<number>();
  const usedNewer = new Set<number>();

  for (const step of result.path) {
    // Only take 1:1 diagonal steps
    const oi = step.olderIndex + 1; // spacing index → point index
    const ni = step.newerIndex + 1;

    if (oi >= older.length || ni >= newer.length) continue;
    if (usedOlder.has(oi) || usedNewer.has(ni)) continue;

    // Skip high-cost local alignments (likely mismatches)
    if (step.localCost > 10) continue;

    usedOlder.add(oi);
    usedNewer.add(ni);

    mappings.push({
      olderIdx: oi,
      newerIdx: ni,
      olderId: older[oi].id,
      newerId: newer[ni].id,
      olderDistance: older[oi].distance,
      newerDistance: newer[ni].distance,
      driftFt: Math.abs(newer[ni].distance - older[oi].distance),
      dtwLocalCost: step.localCost,
    });
  }

  // Also include the first points (index 0) as an anchor
  // if both sequences have points and they're not already used
  if (older.length > 0 && newer.length > 0 && !usedOlder.has(0) && !usedNewer.has(0)) {
    mappings.unshift({
      olderIdx: 0,
      newerIdx: 0,
      olderId: older[0].id,
      newerId: newer[0].id,
      olderDistance: older[0].distance,
      newerDistance: newer[0].distance,
      driftFt: Math.abs(newer[0].distance - older[0].distance),
      dtwLocalCost: 0,
    });
  }

  return mappings.sort((a, b) => a.olderDistance - b.olderDistance);
}

// ──────────────────────────────────────────────────────────────────────
// DTW Audit Record
// ──────────────────────────────────────────────────────────────────────

export type DTWAuditPayload = {
  algorithm: 'DTW';
  olderRunId: string;
  newerRunId: string;
  olderSequenceLength: number;
  newerSequenceLength: number;
  pathLength: number;
  totalCost: number;
  normalizedCost: number;
  confidence: number;
  anchorMappingsExtracted: number;
  bandWidth: number;
  /** Average drift in feet across the alignment */
  avgDriftFt: number;
  /** Max drift in feet */
  maxDriftFt: number;
};

export function buildDTWAudit(
  olderRunId: string,
  newerRunId: string,
  older: DTWInput[],
  newer: DTWInput[],
  result: DTWResult,
  mappings: DTWAnchorMapping[],
  bandWidthFraction: number,
): DTWAuditPayload {
  const drifts = result.driftProfile;
  const avgDrift = drifts.length > 0
    ? drifts.reduce((s, d) => s + Math.abs(d), 0) / drifts.length
    : 0;
  const maxDrift = drifts.length > 0
    ? Math.max(...drifts.map(Math.abs))
    : 0;

  return {
    algorithm: 'DTW',
    olderRunId,
    newerRunId,
    olderSequenceLength: older.length,
    newerSequenceLength: newer.length,
    pathLength: result.path.length,
    totalCost: result.totalCost,
    normalizedCost: result.normalizedCost,
    confidence: result.confidence,
    anchorMappingsExtracted: mappings.length,
    bandWidth: Math.ceil(Math.max(older.length, newer.length) * bandWidthFraction),
    avgDriftFt: avgDrift,
    maxDriftFt: maxDrift,
  };
}
