/**
 * Iterative Closest Point (ICP) — Local Post-Alignment Refinement
 *
 * ───────────────────────────────────────────────────────────────────
 * Purpose:
 *
 *   ICP provides local post-alignment refinement within physically
 *   constrained regions (weld-to-weld segments). It operates AFTER
 *   anchor-based distance correction to fine-tune residual alignment
 *   error that piecewise-linear correction cannot capture.
 *
 * ───────────────────────────────────────────────────────────────────
 * How It Works:
 *
 *   1. Within each weld-to-weld segment, collect anomaly positions
 *      as 2D points: (corrected_distance, clock_position)
 *   2. Find closest-point correspondences between run A and run B
 *   3. Compute optimal rigid transform (translation only — rotation
 *      is not physically meaningful for odometer/clock data)
 *   4. Apply transform and iterate until convergence or max iters
 *   5. Output: residual error per segment, refined offsets, confidence
 *
 * ───────────────────────────────────────────────────────────────────
 * Critical Properties:
 *
 *   - ICP refines alignment, it does NOT define it
 *   - Never used globally — only within constrained weld-to-weld regions
 *   - ICP residuals feed into confidence scoring (ensemble component)
 *   - Deterministic and auditable
 *   - Translation-only (no rotation/scaling of physical coordinates)
 *
 * ───────────────────────────────────────────────────────────────────
 * References:
 *
 *   - Besl & McKay (1992), "A Method for Registration of 3-D Shapes"
 *   - API 1163 §5 — Tool accuracy and repeatability specifications
 *   - Clock position is treated as a linear dimension after circular
 *     unwrapping to avoid wrap-around artifacts
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type ICPPoint = {
  /** Feature ID for traceability */
  id: string;
  /** Corrected distance in feet (X-axis) */
  x: number;
  /** Clock position in hours (Y-axis), null if missing */
  clock: number | null;
};

export type ICPCorrespondence = {
  sourceId: string;
  targetId: string;
  sourcePoint: [number, number];
  targetPoint: [number, number];
  distance: number;
};

export type ICPIterationLog = {
  iteration: number;
  meanResidual: number;
  maxResidual: number;
  translationX: number;
  translationY: number;
  correspondences: number;
};

export type ICPResult = {
  /** Final translation applied (distance offset in feet) */
  translationX: number;
  /** Final translation applied (clock offset in hours) */
  translationY: number;
  /** Mean residual distance after convergence */
  meanResidual: number;
  /** Max residual distance after convergence */
  maxResidual: number;
  /** Root mean squared error */
  rmse: number;
  /** Number of iterations until convergence */
  iterations: number;
  /** Whether ICP converged before max iterations */
  converged: boolean;
  /** Final correspondences */
  correspondences: ICPCorrespondence[];
  /** Per-iteration log (for audit) */
  iterationLog: ICPIterationLog[];
  /** Confidence: 0–100, derived from RMSE */
  confidence: number;
  /** Segment index this ICP was applied to */
  segmentIndex: number;
};

// ──────────────────────────────────────────────────────────────────────
// Clock Normalization
// ──────────────────────────────────────────────────────────────────────

/**
 * Normalize clock to a linear scale avoiding wrap-around.
 * Maps 0-12h to a linear range, handling the 12↔0 boundary.
 * If the majority of points are near 12/0, shifts the origin.
 */
function normalizeClockForICP(points: ICPPoint[]): Map<string, number> {
  const clockMap = new Map<string, number>();
  const clocks = points.filter(p => p.clock != null).map(p => p.clock!);

  if (clocks.length === 0) return clockMap;

  // Check if points straddle the 12/0 boundary
  const nearZero = clocks.filter(c => c < 2 || c > 10).length;
  const straddling = nearZero > clocks.length * 0.3;

  for (const p of points) {
    if (p.clock == null) {
      clockMap.set(p.id, 6); // Default to 6:00 (bottom) if missing
    } else if (straddling && p.clock > 6) {
      // Shift high values down to maintain continuity
      clockMap.set(p.id, p.clock - 12);
    } else {
      clockMap.set(p.id, p.clock);
    }
  }

  return clockMap;
}

// ──────────────────────────────────────────────────────────────────────
// Distance Metric
// ──────────────────────────────────────────────────────────────────────

/**
 * 2D distance between points in (distance_ft, clock_hours) space.
 * Clock is weighted to make 1 hour ≈ 1 foot of circumferential distance
 * on a typical 30-inch pipe (~2.5 ft per clock hour at OD).
 */
const CLOCK_WEIGHT = 2.5; // feet per clock-hour for a ~30" pipe

function point2DDistance(
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = ax - bx;
  const dy = (ay - by) * CLOCK_WEIGHT;
  return Math.sqrt(dx * dx + dy * dy);
}

// ──────────────────────────────────────────────────────────────────────
// Core ICP Algorithm
// ──────────────────────────────────────────────────────────────────────

/**
 * Run ICP on a single weld-to-weld segment.
 *
 * @param source — anomaly points from the older run (to be transformed)
 * @param target — anomaly points from the newer/baseline run (reference)
 * @param segmentIndex — for audit labeling
 * @param maxIterations — convergence limit (default 20)
 * @param convergenceThreshold — stop if mean residual changes < this (default 0.01 ft)
 * @param maxCorrespondenceDistance — reject outlier correspondences (default 5 ft)
 */
export function runICP(
  source: ICPPoint[],
  target: ICPPoint[],
  segmentIndex: number,
  maxIterations = 20,
  convergenceThreshold = 0.01,
  maxCorrespondenceDistance = 5.0,
): ICPResult {
  // Handle degenerate cases
  if (source.length === 0 || target.length === 0) {
    return {
      translationX: 0,
      translationY: 0,
      meanResidual: 0,
      maxResidual: 0,
      rmse: 0,
      iterations: 0,
      converged: true,
      correspondences: [],
      iterationLog: [],
      confidence: source.length === 0 && target.length === 0 ? 100 : 0,
      segmentIndex,
    };
  }

  // Normalize clock positions for both point sets
  const sourceClocks = normalizeClockForICP(source);
  const targetClocks = normalizeClockForICP(target);

  // Build working arrays
  const srcPts: [number, number][] = source.map(p => [
    p.x,
    sourceClocks.get(p.id) ?? 6,
  ]);

  const tgtPts: [number, number][] = target.map(p => [
    p.x,
    targetClocks.get(p.id) ?? 6,
  ]);

  let totalTx = 0;
  let totalTy = 0;
  let prevMeanResidual = Infinity;
  const iterLog: ICPIterationLog[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    // Step 1: Find closest correspondences
    const corr: { si: number; ti: number; dist: number }[] = [];

    for (let si = 0; si < srcPts.length; si++) {
      let bestTi = -1;
      let bestDist = Infinity;

      for (let ti = 0; ti < tgtPts.length; ti++) {
        const d = point2DDistance(
          srcPts[si][0], srcPts[si][1],
          tgtPts[ti][0], tgtPts[ti][1],
        );
        if (d < bestDist) {
          bestDist = d;
          bestTi = ti;
        }
      }

      if (bestTi >= 0 && bestDist <= maxCorrespondenceDistance) {
        corr.push({ si, ti: bestTi, dist: bestDist });
      }
    }

    if (corr.length === 0) {
      iterLog.push({
        iteration: iter,
        meanResidual: Infinity,
        maxResidual: Infinity,
        translationX: 0,
        translationY: 0,
        correspondences: 0,
      });
      break;
    }

    // Step 2: Compute mean residual
    const residuals = corr.map(c => c.dist);
    const meanRes = residuals.reduce((s, r) => s + r, 0) / residuals.length;
    const maxRes = Math.max(...residuals);

    // Step 3: Compute optimal translation (centroid alignment)
    let srcCx = 0, srcCy = 0, tgtCx = 0, tgtCy = 0;
    for (const c of corr) {
      srcCx += srcPts[c.si][0];
      srcCy += srcPts[c.si][1];
      tgtCx += tgtPts[c.ti][0];
      tgtCy += tgtPts[c.ti][1];
    }
    srcCx /= corr.length;
    srcCy /= corr.length;
    tgtCx /= corr.length;
    tgtCy /= corr.length;

    const tx = tgtCx - srcCx;
    const ty = tgtCy - srcCy;

    // Step 4: Apply translation to source points
    for (const pt of srcPts) {
      pt[0] += tx;
      pt[1] += ty;
    }

    totalTx += tx;
    totalTy += ty;

    iterLog.push({
      iteration: iter,
      meanResidual: meanRes,
      maxResidual: maxRes,
      translationX: tx,
      translationY: ty,
      correspondences: corr.length,
    });

    // Step 5: Check convergence
    if (Math.abs(meanRes - prevMeanResidual) < convergenceThreshold) {
      // Converged — build final correspondences and return
      const finalCorr = buildFinalCorrespondences(source, target, srcPts, tgtPts, maxCorrespondenceDistance);
      const rmse = computeRMSE(finalCorr);

      return {
        translationX: totalTx,
        translationY: totalTy / CLOCK_WEIGHT, // Convert back to clock-hours
        meanResidual: meanRes,
        maxResidual: maxRes,
        rmse,
        iterations: iter + 1,
        converged: true,
        correspondences: finalCorr,
        iterationLog: iterLog,
        confidence: rmseToConfidence(rmse),
        segmentIndex,
      };
    }

    prevMeanResidual = meanRes;
  }

  // Did not converge — return best result
  const finalCorr = buildFinalCorrespondences(source, target, srcPts, tgtPts, maxCorrespondenceDistance);
  const rmse = computeRMSE(finalCorr);
  const lastLog = iterLog[iterLog.length - 1];

  return {
    translationX: totalTx,
    translationY: totalTy / CLOCK_WEIGHT,
    meanResidual: lastLog?.meanResidual ?? Infinity,
    maxResidual: lastLog?.maxResidual ?? Infinity,
    rmse,
    iterations: iterLog.length,
    converged: false,
    correspondences: finalCorr,
    iterationLog: iterLog,
    confidence: rmseToConfidence(rmse),
    segmentIndex,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function buildFinalCorrespondences(
  source: ICPPoint[],
  target: ICPPoint[],
  srcPts: [number, number][],
  tgtPts: [number, number][],
  maxDist: number,
): ICPCorrespondence[] {
  const corr: ICPCorrespondence[] = [];

  for (let si = 0; si < srcPts.length; si++) {
    let bestTi = -1;
    let bestDist = Infinity;

    for (let ti = 0; ti < tgtPts.length; ti++) {
      const d = point2DDistance(srcPts[si][0], srcPts[si][1], tgtPts[ti][0], tgtPts[ti][1]);
      if (d < bestDist) {
        bestDist = d;
        bestTi = ti;
      }
    }

    if (bestTi >= 0 && bestDist <= maxDist) {
      corr.push({
        sourceId: source[si].id,
        targetId: target[bestTi].id,
        sourcePoint: srcPts[si],
        targetPoint: tgtPts[bestTi],
        distance: bestDist,
      });
    }
  }

  return corr;
}

function computeRMSE(correspondences: ICPCorrespondence[]): number {
  if (correspondences.length === 0) return Infinity;
  const sumSq = correspondences.reduce((s, c) => s + c.distance * c.distance, 0);
  return Math.sqrt(sumSq / correspondences.length);
}

/**
 * Map RMSE to confidence (0–100).
 * RMSE 0 ft → 100%, 1 ft → ~72%, 3 ft → ~37%, 10 ft → ~5%
 */
function rmseToConfidence(rmse: number): number {
  if (!Number.isFinite(rmse)) return 0;
  return Math.max(0, Math.min(100, 100 * Math.exp(-rmse / 3)));
}

// ──────────────────────────────────────────────────────────────────────
// ICP Audit Record
// ──────────────────────────────────────────────────────────────────────

export type ICPAuditPayload = {
  algorithm: 'ICP';
  segmentIndex: number;
  olderRunId: string;
  newerRunId: string;
  sourcePointCount: number;
  targetPointCount: number;
  iterations: number;
  converged: boolean;
  translationDistanceFt: number;
  translationClockHrs: number;
  rmse: number;
  meanResidual: number;
  maxResidual: number;
  confidence: number;
  correspondenceCount: number;
};

export function buildICPAudit(
  result: ICPResult,
  olderRunId: string,
  newerRunId: string,
  sourceCount: number,
  targetCount: number,
): ICPAuditPayload {
  return {
    algorithm: 'ICP',
    segmentIndex: result.segmentIndex,
    olderRunId,
    newerRunId,
    sourcePointCount: sourceCount,
    targetPointCount: targetCount,
    iterations: result.iterations,
    converged: result.converged,
    translationDistanceFt: result.translationX,
    translationClockHrs: result.translationY,
    rmse: result.rmse,
    meanResidual: result.meanResidual,
    maxResidual: result.maxResidual,
    confidence: result.confidence,
    correspondenceCount: result.correspondences.length,
  };
}
