/**
 * Run 3 (Baseline) Matching Refinement
 *
 * Post-matching, pre-scoring consolidation step that ensures baseline
 * (newest run) anomalies are properly anchored to earlier runs and
 * suppresses over-representation from higher-fidelity reporting.
 *
 * ───────────────────────────────────────────────────────────────────
 * Architecture:
 *
 *   Runs AFTER stage 5 (anomaly matching) and BEFORE stage 6 (scoring).
 *   Does NOT modify alignment, correction, or matching logic.
 *   Does NOT delete any data — only adds Exception records.
 *
 * ───────────────────────────────────────────────────────────────────
 * Steps:
 *
 *   1. Neighborhood Duplicate Detection
 *      If an unmatched baseline anomaly is within NEIGHBORHOOD_RADIUS_FT
 *      of a matched baseline anomaly of the same type, it is flagged as
 *      a likely split/duplicate (NEIGHBORHOOD_EXCESS exception).
 *
 *   2. Dense Cluster Detection
 *      If ≥ CLUSTER_UNMATCHED_THRESHOLD unmatched anomalies exist in a
 *      neighborhood with ≤1 matched anomaly, the excess are flagged.
 *      This catches "phantom clusters" from high-fidelity tools.
 *
 *   3. Unanchored Classification
 *      Remaining unmatched baseline features are classified as:
 *        - TRUE_NEW: well-documented (≥2 measurement fields), spatially
 *          distinct — left as-is (legitimate new anomaly)
 *        - RUN3_UNSUPPORTED: sparse data + no match → Exception created
 *
 *   4. Hierarchical Match Audit
 *      Baseline features matched in multiple older runs get an audit
 *      Exception (MULTI_RUN_MATCH) logging which match is primary
 *      (temporally closer run preferred).
 *
 * ───────────────────────────────────────────────────────────────────
 * Safeguards:
 *
 *   - No features or matches are deleted
 *   - All flagged features remain stored, queryable, reviewable
 *   - Every suppression has a reason code + audit details
 *   - Deterministic: same input always produces same output
 *
 * ───────────────────────────────────────────────────────────────────
 * Downstream Impact:
 *
 *   The visualization API loads these Exception records and applies
 *   visibility overrides:
 *     NEIGHBORHOOD_EXCESS → hidden by default
 *     RUN3_UNSUPPORTED    → dimmed by default
 *     MULTI_RUN_MATCH     → audit only, no visibility change
 *
 *   Users can still reveal all features via "Show Low-Confidence" toggle.
 */

import { Types } from 'mongoose';
import { Exception, Feature, MatchedPair } from '@/lib/db/models';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

type FeatureForRefinement = {
  _id: Types.ObjectId;
  run_id: Types.ObjectId;
  log_distance_ft?: number | null;
  corrected_distance_ft?: number | null;
  event_type_canonical: string;
  depth_percent?: number | null;
  depth_in?: number | null;
  length_in?: number | null;
  width_in?: number | null;
  clock_decimal?: number | null;
};

type MatchForRefinement = {
  _id: Types.ObjectId;
  run_a_feature_id: Types.ObjectId;
  run_b_feature_id: Types.ObjectId;
  run_a_run_id: Types.ObjectId;
  run_b_run_id: Types.ObjectId;
  confidence_score: number;
  confidence_category: string;
  match_category: string;
  distance_residual_ft: number;
};

export type RefinementSummary = {
  neighborhoodSuppressed: number;
  clusterSuppressed: number;
  classifiedNew: number;
  classifiedUnsupported: number;
  hierarchicalAudits: number;
  totalBaselineAnomalies: number;
  totalMatched: number;
  totalUnmatched: number;
  auditRecords: number;
};

// ──────────────────────────────────────────────────────────────────────
// Configurable Thresholds
// ──────────────────────────────────────────────────────────────────────

/** Features within this radius (ft) of a matched feature are considered neighborhood duplicates */
const NEIGHBORHOOD_RADIUS_FT = 3.0;

/** Clusters of this many unmatched features in a sparse neighborhood are flagged */
const CLUSTER_UNMATCHED_THRESHOLD = 3;

/** Minimum populated measurement fields to classify as TRUE_NEW vs UNSUPPORTED */
const MIN_DATA_COMPLETENESS = 2;

/** Control/reference types excluded from anomaly refinement */
const REFERENCE_TYPES = new Set([
  'GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'FLANGE', 'SUPPORT',
  'LAUNCHER', 'RECEIVER', 'AGM', 'BEND', 'FIELD_BEND'
]);

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function getDistance(f: FeatureForRefinement): number {
  return f.corrected_distance_ft ?? f.log_distance_ft ?? 0;
}

function countPopulatedFields(f: FeatureForRefinement): number {
  let count = 0;
  if (f.depth_percent != null && Number.isFinite(f.depth_percent)) count++;
  if (f.depth_in != null && Number.isFinite(f.depth_in)) count++;
  if (f.length_in != null && Number.isFinite(f.length_in)) count++;
  if (f.width_in != null && Number.isFinite(f.width_in)) count++;
  if (f.clock_decimal != null && Number.isFinite(f.clock_decimal)) count++;
  return count;
}

// ──────────────────────────────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────────────────────────────

/**
 * Refines baseline anomaly matches after the main matching stage.
 *
 * @param args.jobId         The alignment job ID
 * @param args.baselineRunId The baseline (newest) run ID
 * @param args.olderRunIds   Older run IDs sorted oldest → newest
 * @returns Summary of refinement actions taken
 */
export async function refineBaselineMatches(args: {
  jobId: string;
  baselineRunId: string;
  olderRunIds: string[];
}): Promise<RefinementSummary> {
  // Load baseline anomalies (exclude control/reference points)
  const baselineAnomalies = await Feature.find({
    run_id: args.baselineRunId,
    event_type_canonical: { $nin: [...REFERENCE_TYPES] }
  })
    .select('run_id log_distance_ft corrected_distance_ft event_type_canonical depth_percent depth_in length_in width_in clock_decimal')
    .lean<FeatureForRefinement[]>();

  // Load all matches where baseline is the newer run (run_b)
  const allMatches = await MatchedPair.find({
    job_id: args.jobId,
    run_b_run_id: args.baselineRunId
  })
    .select('run_a_feature_id run_b_feature_id run_a_run_id run_b_run_id confidence_score confidence_category match_category distance_residual_ft')
    .lean<MatchForRefinement[]>();

  // ── Build lookup structures ──

  // Matched baseline feature IDs → their match records
  const matchesByBaselineFeature = new Map<string, MatchForRefinement[]>();
  const matchedBaselineIds = new Set<string>();

  for (const m of allMatches) {
    const bfId = m.run_b_feature_id.toString();
    matchedBaselineIds.add(bfId);
    const existing = matchesByBaselineFeature.get(bfId) ?? [];
    existing.push(m);
    matchesByBaselineFeature.set(bfId, existing);
  }

  // Separate matched vs unmatched baseline anomalies
  const unmatchedBaseline = baselineAnomalies.filter(
    (f) => !matchedBaselineIds.has(f._id.toString())
  );

  // Sort all baseline anomalies by distance for spatial analysis
  const sortedMatched = baselineAnomalies
    .filter((f) => matchedBaselineIds.has(f._id.toString()))
    .sort((a, b) => getDistance(a) - getDistance(b));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exceptionInserts: any[] = [];
  const flaggedIds = new Set<string>();

  // ════════════════════════════════════════════════════════════════════
  // Step 1: Neighborhood Duplicate Detection
  // ════════════════════════════════════════════════════════════════════
  //
  // For each unmatched baseline anomaly, check if a matched baseline
  // anomaly of the same type exists within NEIGHBORHOOD_RADIUS_FT.
  // If so, the unmatched one is likely a split/duplicate from
  // higher-fidelity reporting.

  for (const unmatched of unmatchedBaseline) {
    const uid = unmatched._id.toString();
    const ud = getDistance(unmatched);

    // Binary-search-style scan through sorted matched features
    let bestDist = Infinity;
    let bestMatchedId: string | null = null;
    let bestMatchScore: number | null = null;

    for (const matched of sortedMatched) {
      const md = getDistance(matched);
      const dist = Math.abs(md - ud);

      // Early exit: sorted, so once we pass the window we're done
      if (md > ud + NEIGHBORHOOD_RADIUS_FT) break;
      if (md < ud - NEIGHBORHOOD_RADIUS_FT) continue;

      // Same type check (or compatible types)
      if (matched.event_type_canonical !== unmatched.event_type_canonical) continue;

      if (dist < bestDist) {
        bestDist = dist;
        bestMatchedId = matched._id.toString();
        const matches = matchesByBaselineFeature.get(bestMatchedId);
        bestMatchScore = matches?.[0]?.confidence_score ?? null;
      }
    }

    if (bestMatchedId && bestDist <= NEIGHBORHOOD_RADIUS_FT) {
      flaggedIds.add(uid);
      exceptionInserts.push({
        job_id: args.jobId,
        run_id: args.baselineRunId,
        feature_id: unmatched._id,
        category: 'NEIGHBORHOOD_EXCESS',
        severity: 'LOW',
        details: {
          reason: 'Likely split/duplicate of nearby matched anomaly',
          nearestMatchedFeatureId: bestMatchedId,
          distanceToMatchedFt: Math.round(bestDist * 100) / 100,
          matchedFeatureScore: bestMatchScore,
          featureType: unmatched.event_type_canonical,
          featureDistanceFt: Math.round(ud * 10) / 10,
          classification: 'NEIGHBORHOOD_DUPLICATE'
        }
      });
    }
  }

  const neighborhoodSuppressed = flaggedIds.size;

  // ════════════════════════════════════════════════════════════════════
  // Step 2: Dense Cluster Detection
  // ════════════════════════════════════════════════════════════════════
  //
  // Among remaining unflagged unmatched features, find dense clusters
  // where CLUSTER_UNMATCHED_THRESHOLD+ unmatched features exist in a
  // small neighborhood with ≤1 matched features. These are likely
  // phantom clusters from high-resolution tool reporting.

  const remainingUnmatched = unmatchedBaseline
    .filter((f) => !flaggedIds.has(f._id.toString()))
    .sort((a, b) => getDistance(a) - getDistance(b));

  let clusterSuppressed = 0;

  for (let i = 0; i < remainingUnmatched.length; i++) {
    const f = remainingUnmatched[i];
    const fid = f._id.toString();
    if (flaggedIds.has(fid)) continue;

    const fd = getDistance(f);

    // Count unmatched neighbors within radius
    let unmatchedNeighbors = 0;
    for (let j = 0; j < remainingUnmatched.length; j++) {
      if (i === j) continue;
      const od = getDistance(remainingUnmatched[j]);
      if (Math.abs(od - fd) <= NEIGHBORHOOD_RADIUS_FT) {
        unmatchedNeighbors++;
      }
      // Sorted, so early exit
      if (od > fd + NEIGHBORHOOD_RADIUS_FT) break;
    }

    // Count matched neighbors within radius
    let matchedNeighbors = 0;
    for (const matched of sortedMatched) {
      const md = getDistance(matched);
      if (Math.abs(md - fd) <= NEIGHBORHOOD_RADIUS_FT) {
        matchedNeighbors++;
      }
      if (md > fd + NEIGHBORHOOD_RADIUS_FT) break;
    }

    // Flag if dense unmatched cluster with few/no matched neighbors
    if (unmatchedNeighbors >= CLUSTER_UNMATCHED_THRESHOLD && matchedNeighbors <= 1) {
      flaggedIds.add(fid);
      clusterSuppressed++;
      exceptionInserts.push({
        job_id: args.jobId,
        run_id: args.baselineRunId,
        feature_id: f._id,
        category: 'NEIGHBORHOOD_EXCESS',
        severity: 'MEDIUM',
        details: {
          reason: 'Dense cluster of unmatched anomalies without matched anchor',
          unmatchedInRadius: unmatchedNeighbors + 1,
          matchedInRadius: matchedNeighbors,
          radiusFt: NEIGHBORHOOD_RADIUS_FT,
          featureType: f.event_type_canonical,
          featureDistanceFt: Math.round(fd * 10) / 10,
          classification: 'DENSE_CLUSTER'
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Step 3: Unanchored Feature Classification
  // ════════════════════════════════════════════════════════════════════
  //
  // Remaining unmatched, unflagged features are classified:
  //   - If ≥ MIN_DATA_COMPLETENESS measurement fields → TRUE_NEW
  //   - If < MIN_DATA_COMPLETENESS → RUN3_UNSUPPORTED (Exception)

  let classifiedNew = 0;
  let classifiedUnsupported = 0;

  const stillUnclassified = unmatchedBaseline.filter(
    (f) => !flaggedIds.has(f._id.toString())
  );

  for (const f of stillUnclassified) {
    const completeness = countPopulatedFields(f);

    if (completeness >= MIN_DATA_COMPLETENESS) {
      // Well-documented, spatially distinct → legitimate new anomaly
      classifiedNew++;
      // No exception — this is a true new anomaly. The existing
      // UNMATCHED exception from stage 5 remains as-is.
    } else {
      // Sparse data, no match → unsupported
      classifiedUnsupported++;
      exceptionInserts.push({
        job_id: args.jobId,
        run_id: args.baselineRunId,
        feature_id: f._id,
        category: 'RUN3_UNSUPPORTED',
        severity: 'LOW',
        details: {
          reason: 'Baseline anomaly with no historic match and insufficient measurement data',
          populatedFields: completeness,
          requiredFields: MIN_DATA_COMPLETENESS,
          featureType: f.event_type_canonical,
          featureDistanceFt: Math.round(getDistance(f) * 10) / 10,
          classification: 'UNSUPPORTED'
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Step 4: Hierarchical Match Audit
  // ════════════════════════════════════════════════════════════════════
  //
  // For baseline features matched in multiple older runs, log which
  // match is primary (prefer temporally closer run). This is for
  // audit/traceability only — no matches are suppressed.

  let hierarchicalAudits = 0;

  for (const [bfId, matches] of matchesByBaselineFeature) {
    if (matches.length <= 1) continue;

    hierarchicalAudits++;

    // Sort by run proximity: newer older runs have higher priority
    // olderRunIds is sorted oldest→newest, so higher index = closer in time
    const sorted = [...matches].sort((a, b) => {
      const aIdx = args.olderRunIds.indexOf(a.run_a_run_id.toString());
      const bIdx = args.olderRunIds.indexOf(b.run_a_run_id.toString());
      return bIdx - aIdx; // higher index first
    });

    const primary = sorted[0];
    const secondary = sorted.slice(1);

    exceptionInserts.push({
      job_id: args.jobId,
      run_id: args.baselineRunId,
      feature_id: new Types.ObjectId(bfId),
      category: 'MULTI_RUN_MATCH',
      severity: 'LOW',
      details: {
        reason: `Feature matched in ${matches.length} older runs; temporally closest is primary`,
        primaryMatch: {
          olderRunId: primary.run_a_run_id.toString(),
          olderFeatureId: primary.run_a_feature_id.toString(),
          score: primary.confidence_score,
          category: primary.confidence_category,
          residualFt: primary.distance_residual_ft
        },
        secondaryMatches: secondary.map((m) => ({
          olderRunId: m.run_a_run_id.toString(),
          olderFeatureId: m.run_a_feature_id.toString(),
          score: m.confidence_score,
          category: m.confidence_category,
          residualFt: m.distance_residual_ft
        })),
        classification: 'HIERARCHICAL_MATCH'
      }
    });
  }

  // ── Persist exception records ──

  for (let i = 0; i < exceptionInserts.length; i += 1000) {
    await Exception.insertMany(exceptionInserts.slice(i, i + 1000), { ordered: false });
  }

  const summary: RefinementSummary = {
    neighborhoodSuppressed,
    clusterSuppressed,
    classifiedNew,
    classifiedUnsupported,
    hierarchicalAudits,
    totalBaselineAnomalies: baselineAnomalies.length,
    totalMatched: matchedBaselineIds.size,
    totalUnmatched: unmatchedBaseline.length,
    auditRecords: exceptionInserts.length
  };

  console.log(`[Run3 Refinement] Summary:`, JSON.stringify(summary, null, 2));

  return summary;
}
