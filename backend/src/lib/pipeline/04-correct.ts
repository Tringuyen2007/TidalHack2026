import { Types } from 'mongoose';
import { Feature, AlignedFeature } from '@/lib/db/models';
import { buildCorrectionSegments, interpolateOffset } from './utils/correction';
import type { AnchorPair } from './types';

type Block = AnchorPair[];

function splitByReset(anchors: AnchorPair[]): Block[] {
  if (anchors.length === 0) return [];

  const blocks: Block[] = [];
  let current: Block = [anchors[0]];

  for (let i = 1; i < anchors.length; i += 1) {
    if (anchors[i].isResetPoint) {
      if (current.length > 0) blocks.push(current);
      current = [anchors[i]];
    } else {
      current.push(anchors[i]);
    }
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

export async function applyDistanceCorrection(args: {
  jobId: string;
  olderRunId: string;
  newerRunId: string;
  anchors: AnchorPair[];
}) {
  const olderFeatures = await Feature.find({ run_id: args.olderRunId }).lean<
    Array<{ _id: Types.ObjectId; log_distance_ft?: number | null }>
  >();
  const blocks = splitByReset(args.anchors);
  const segmentsByBlock = blocks.map((block) => buildCorrectionSegments(block));

  const alignedInserts: {
    job_id: string;
    feature_id: string;
    run_id: string;
    baseline_run_id: string;
    original_distance_ft: number;
    corrected_distance_ft: number;
    applied_offset_ft: number;
    segment_index: number;
  }[] = [];

  // Build bulk update operations instead of individual updateOne calls
  const bulkOps: { updateOne: { filter: { _id: Types.ObjectId }; update: { corrected_distance_ft: number } } }[] = [];

  for (const feature of olderFeatures) {
    const dist = feature.log_distance_ft ?? 0;

    let blockIndex = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const start = blocks[i][0]?.olderDistance ?? -Number.POSITIVE_INFINITY;
      const end = blocks[i][blocks[i].length - 1]?.olderDistance ?? Number.POSITIVE_INFINITY;
      if (dist >= start && dist <= end) {
        blockIndex = i;
        break;
      }
    }

    const segments = segmentsByBlock[blockIndex] ?? [];
    const offset = interpolateOffset(dist, segments);
    const corrected = dist + offset;

    bulkOps.push({
      updateOne: {
        filter: { _id: feature._id },
        update: { corrected_distance_ft: corrected }
      }
    });

    alignedInserts.push({
      job_id: args.jobId,
      feature_id: feature._id.toString(),
      run_id: args.olderRunId,
      baseline_run_id: args.newerRunId,
      original_distance_ft: dist,
      corrected_distance_ft: corrected,
      applied_offset_ft: offset,
      segment_index: blockIndex
    });
  }

  const newerFeatures = await Feature.find({ run_id: args.newerRunId })
    .select({ _id: 1, log_distance_ft: 1 })
    .lean<Array<{ _id: Types.ObjectId; log_distance_ft?: number | null }>>();
  for (const feature of newerFeatures) {
    bulkOps.push({
      updateOne: {
        filter: { _id: feature._id },
        update: { corrected_distance_ft: feature.log_distance_ft ?? 0 }
      }
    });
  }

  // Execute all feature updates in batches of 1000
  for (let i = 0; i < bulkOps.length; i += 1000) {
    const batch = bulkOps.slice(i, i + 1000);
    await Feature.bulkWrite(batch, { ordered: false });
  }

  if (alignedInserts.length > 0) {
    // Insert aligned features in batches of 1000
    for (let i = 0; i < alignedInserts.length; i += 1000) {
      const batch = alignedInserts.slice(i, i + 1000);
      await AlignedFeature.insertMany(batch, { ordered: false });
    }
  }
}
