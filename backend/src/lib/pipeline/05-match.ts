import { Types } from 'mongoose';
import { Exception, Feature, MatchedPair, Run } from '@/lib/db/models';
import type { AnchorPair, MatchCandidate } from './types';
import { hungarian } from './utils/hungarian';
import { calculateEnsembleScore } from './utils/ensemble-scoring';
import { confidenceCategory } from './utils/scoring';

type FeatureLite = {
  _id: Types.ObjectId;
  run_id: Types.ObjectId;
  corrected_distance_ft?: number | null;
  event_type_canonical: string;
  depth_percent?: number | null;
  depth_in?: number | null;
  length_in?: number | null;
  width_in?: number | null;
  clock_decimal?: number | null;
};

type RunLite = {
  _id: Types.ObjectId;
  year: number;
};

const REFERENCE_TYPES = new Set(['GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'FLANGE', 'SUPPORT', 'LAUNCHER', 'RECEIVER']);

function getSegmentBounds(anchors: AnchorPair[], index: number): { min: number; max: number } {
  if (anchors.length < 2) {
    return { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER };
  }

  const a = anchors[index];
  const b = anchors[index + 1];

  if (!a || !b) {
    const last = anchors[anchors.length - 1];
    return { min: last?.newerDistance ?? -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER };
  }

  return {
    min: a.newerDistance,
    max: b.newerDistance
  };
}

export async function matchAnomalies(args: {
  jobId: string;
  olderRunId: string;
  newerRunId: string;
  anchors: AnchorPair[];
  /** DTW confidence for this run pair (0–100), passed to ensemble scorer */
  dtwConfidence?: number | null;
  /** ICP average RMSE across segments for this pair (ft), passed to ensemble scorer */
  icpRmse?: number | null;
  /** Total number of runs in the dataset, for temporal persistence scoring */
  totalRunCount?: number;
}) {
  const [olderRun, newerRun] = await Promise.all([
    Run.findById(args.olderRunId).lean<RunLite | null>(),
    Run.findById(args.newerRunId).lean<RunLite | null>()
  ]);
  if (!olderRun || !newerRun) {
    return;
  }

  const yearsBetween = Math.max(0.01, newerRun.year - olderRun.year);

  const [olderFeatures, newerFeatures] = await Promise.all([
    Feature.find({ run_id: args.olderRunId, event_type_canonical: { $nin: [...REFERENCE_TYPES] } })
      .select({
        run_id: 1,
        corrected_distance_ft: 1,
        event_type_canonical: 1,
        depth_percent: 1,
        depth_in: 1,
        length_in: 1,
        width_in: 1,
        clock_decimal: 1
      })
      .lean<FeatureLite[]>(),
    Feature.find({ run_id: args.newerRunId, event_type_canonical: { $nin: [...REFERENCE_TYPES] } })
      .select({
        run_id: 1,
        corrected_distance_ft: 1,
        event_type_canonical: 1,
        depth_percent: 1,
        depth_in: 1,
        length_in: 1,
        width_in: 1,
        clock_decimal: 1
      })
      .lean<FeatureLite[]>()
  ]);

  const matchedOlder = new Set<string>();
  const matchedNewer = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchInserts: any[] = [];

  const totalSegments = Math.max(1, args.anchors.length - 1);

  for (let segmentIndex = 0; segmentIndex < totalSegments; segmentIndex += 1) {
    const bounds = getSegmentBounds(args.anchors, segmentIndex);

    const olderSegment = olderFeatures.filter((f) => {
      const d = f.corrected_distance_ft ?? 0;
      return d >= bounds.min && d < bounds.max;
    });

    const newerSegment = newerFeatures.filter((f) => {
      const d = f.corrected_distance_ft ?? 0;
      return d >= bounds.min && d < bounds.max;
    });

    if (olderSegment.length === 0 || newerSegment.length === 0) {
      continue;
    }

    const scoresByNewer = new Map<string, MatchCandidate[]>();
    const scoreMatrix: number[][] = olderSegment.map((older) =>
      newerSegment.map((newer) => {
        const breakdown = calculateEnsembleScore({
          distanceResidualFt: Math.abs((older.corrected_distance_ft ?? 0) - (newer.corrected_distance_ft ?? 0)),
          olderClock: older.clock_decimal,
          newerClock: newer.clock_decimal,
          olderType: older.event_type_canonical,
          newerType: newer.event_type_canonical,
          olderDepthIn: older.depth_in,
          newerDepthIn: newer.depth_in,
          olderLengthIn: older.length_in,
          newerLengthIn: newer.length_in,
          olderWidthIn: older.width_in,
          newerWidthIn: newer.width_in,
          dtwConfidence: args.dtwConfidence,
          icpRmse: args.icpRmse,
          totalRunCount: args.totalRunCount,
        });

        const candidate: MatchCandidate = {
          olderFeatureId: older._id.toString(),
          newerFeatureId: newer._id.toString(),
          score: breakdown.total,
          distanceResidualFt: Math.abs((older.corrected_distance_ft ?? 0) - (newer.corrected_distance_ft ?? 0)),
          clockResidualHrs: breakdown.clockResidual,
          typeCompatibility: breakdown.typeScore,
          dimensionalSimilarity: breakdown.dimensionalScore
        };

        const list = scoresByNewer.get(newer._id.toString()) ?? [];
        list.push(candidate);
        scoresByNewer.set(newer._id.toString(), list);

        return 100 - breakdown.total;
      })
    );

    const assignments = hungarian(scoreMatrix);
    for (const assignment of assignments) {
      const older = olderSegment[assignment.row];
      const newer = newerSegment[assignment.col];
      const score = 100 - assignment.cost;

      if (score < 25) {
        continue;
      }

      const candidateList = (scoresByNewer.get(newer._id.toString()) ?? []).sort((a, b) => b.score - a.score);
      const top = candidateList[0];
      const second = candidateList[1];

      let category: 'AUTO_MATCHED' | 'BEST_MATCH' | 'AMBIGUOUS' = 'AUTO_MATCHED';
      if (candidateList.length > 1) {
        category = second && top && top.score - second.score < 10 ? 'AMBIGUOUS' : 'BEST_MATCH';
      }

      const depthGrowth = ((newer.depth_percent ?? 0) - (older.depth_percent ?? 0)) / yearsBetween;
      const lengthGrowth = ((newer.length_in ?? 0) - (older.length_in ?? 0)) / yearsBetween;
      const widthGrowth = ((newer.width_in ?? 0) - (older.width_in ?? 0)) / yearsBetween;

      matchInserts.push({
        job_id: args.jobId,
        run_a_feature_id: older._id,
        run_b_feature_id: newer._id,
        run_a_run_id: args.olderRunId,
        run_b_run_id: args.newerRunId,
        distance_residual_ft: Math.abs((older.corrected_distance_ft ?? 0) - (newer.corrected_distance_ft ?? 0)),
        clock_residual_hrs: top?.clockResidualHrs,
        type_compatibility: top?.typeCompatibility ?? 0,
        dimensional_similarity: top?.dimensionalSimilarity ?? 0,
        confidence_score: score,
        confidence_category: confidenceCategory(score),
        match_category: category,
        depth_growth_pct_yr: depthGrowth,
        length_growth_in_yr: lengthGrowth,
        width_growth_in_yr: widthGrowth,
        years_between: yearsBetween,
        competing_candidates: candidateList.slice(1).map((candidate) => new Types.ObjectId(candidate.olderFeatureId))
      });

      matchedOlder.add(older._id.toString());
      matchedNewer.add(newer._id.toString());
    }
  }

  // Collect exception inserts for unmatched features
  const exceptionInserts: {
    job_id: string;
    run_id: string;
    feature_id: Types.ObjectId;
    category: string;
    severity: string;
    details: { reason: string };
  }[] = [];

  for (const feature of olderFeatures) {
    if (!matchedOlder.has(feature._id.toString())) {
      exceptionInserts.push({
        job_id: args.jobId,
        run_id: args.olderRunId,
        feature_id: feature._id,
        category: 'UNMATCHED',
        severity: 'MEDIUM',
        details: { reason: 'No valid match in baseline run' }
      });
    }
  }

  for (const feature of newerFeatures) {
    if (!matchedNewer.has(feature._id.toString())) {
      exceptionInserts.push({
        job_id: args.jobId,
        run_id: args.newerRunId,
        feature_id: feature._id,
        category: 'UNMATCHED',
        severity: 'LOW',
        details: { reason: 'New anomaly or no historic equivalent' }
      });
    }
  }

  // Bulk insert matches in batches of 1000
  for (let i = 0; i < matchInserts.length; i += 1000) {
    await MatchedPair.insertMany(matchInserts.slice(i, i + 1000), { ordered: false });
  }

  // Bulk insert exceptions in batches of 1000
  for (let i = 0; i < exceptionInserts.length; i += 1000) {
    await Exception.insertMany(exceptionInserts.slice(i, i + 1000), { ordered: false });
  }
}
