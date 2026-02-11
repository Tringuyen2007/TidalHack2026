import { Types } from 'mongoose';
import { Feature, Run, Exception } from '@/lib/db/models';
import type { AnchorPair } from './types';

type WeldRow = {
  _id: Types.ObjectId;
  joint_number?: number | null;
  log_distance_ft?: number | null;
  corrected_distance_ft?: number | null;
};

function distance(value: number | null | undefined) {
  return value ?? Number.POSITIVE_INFINITY;
}

export async function matchAnchorsForRunPair(args: {
  jobId: string;
  olderRunId: string;
  newerRunId: string;
}): Promise<AnchorPair[]> {
  const olderRun = await Run.findById(args.olderRunId).lean();
  const newerRun = await Run.findById(args.newerRunId).lean();
  if (!olderRun || !newerRun) {
    return [];
  }

  const [olderWelds, newerWelds] = await Promise.all([
    Feature.find({ run_id: args.olderRunId, event_type_canonical: 'GIRTH_WELD' })
      .sort({ log_distance_ft: 1 })
      .lean<WeldRow[]>(),
    Feature.find({ run_id: args.newerRunId, event_type_canonical: 'GIRTH_WELD' })
      .sort({ log_distance_ft: 1 })
      .lean<WeldRow[]>()
  ]);

  if (olderWelds.length === 0 || newerWelds.length === 0) {
    return [];
  }

  const newerByJoint = new Map<number, WeldRow>();
  for (const weld of newerWelds) {
    if (weld.joint_number != null) {
      newerByJoint.set(weld.joint_number, weld);
    }
  }

  const offsets: number[] = [];
  const provisional: AnchorPair[] = [];

  let lastNewerDistance = -Number.POSITIVE_INFINITY;
  for (const older of olderWelds) {
    const olderDist = distance(older.corrected_distance_ft ?? older.log_distance_ft);
    if (!Number.isFinite(olderDist)) continue;

    let candidate: WeldRow | undefined;

    if (older.joint_number != null) {
      candidate = newerByJoint.get(older.joint_number ?? -1);
    }

    if (!candidate) {
      const medianOffset = offsets.length === 0 ? 0 : offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
      const expected = olderDist + medianOffset;
      candidate = newerWelds
        .filter((w) => distance(w.log_distance_ft) > lastNewerDistance)
        .sort((a, b) => Math.abs(distance(a.log_distance_ft) - expected) - Math.abs(distance(b.log_distance_ft) - expected))[0];
    }

    if (!candidate) continue;

    const newerDist = distance(candidate.log_distance_ft);
    if (!Number.isFinite(newerDist) || newerDist <= lastNewerDistance) continue;

    offsets.push(newerDist - olderDist);
    lastNewerDistance = newerDist;

    provisional.push({
      olderWeldFeatureId: older._id.toString(),
      newerWeldFeatureId: candidate._id.toString(),
      olderDistance: olderDist,
      newerDistance: newerDist,
      olderJoint: older.joint_number ?? undefined,
      newerJoint: candidate.joint_number ?? undefined,
      segmentIndex: provisional.length,
      driftFt: Math.abs(newerDist - olderDist)
    });
  }

  const anchors = provisional.filter((anchor, i, arr) => {
    if (i === 0) return true;
    return anchor.olderDistance > arr[i - 1].olderDistance && anchor.newerDistance > arr[i - 1].newerDistance;
  });

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const olderDeltaJoint = (b.olderJoint ?? 0) - (a.olderJoint ?? 0);
    const newerDeltaJoint = (b.newerJoint ?? 0) - (a.newerJoint ?? 0);
    if (Math.abs(newerDeltaJoint - olderDeltaJoint) >= 2) {
      b.isResetPoint = true;
      await Exception.create({
        job_id: args.jobId,
        run_id: args.olderRunId,
        category: 'CUTOUT_RESET',
        severity: 'MEDIUM',
        details: {
          atOlderDistance: b.olderDistance,
          atNewerDistance: b.newerDistance,
          olderDeltaJoint,
          newerDeltaJoint
        }
      });
    }

    const segmentDrift = Math.abs((b.newerDistance - a.newerDistance) - (b.olderDistance - a.olderDistance));
    if (segmentDrift > 5) {
      await Exception.create({
        job_id: args.jobId,
        run_id: args.olderRunId,
        category: 'SEGMENT_DRIFT',
        severity: segmentDrift > 10 ? 'HIGH' : 'MEDIUM',
        details: {
          fromAnchor: a.segmentIndex,
          toAnchor: b.segmentIndex,
          segmentDriftFt: segmentDrift
        }
      });
    }
  }

  return anchors;
}
