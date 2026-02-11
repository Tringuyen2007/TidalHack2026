import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { connectToDatabase } from '@/lib/db/mongoose';
import { AlignmentJob, Feature, Run, MatchedPair, Exception } from '@/lib/db/models';
import { computeVisibility } from '@/lib/pipeline/utils/visibility-confidence';
import type { FeatureForVisibility } from '@/lib/pipeline/utils/visibility-confidence';
import type { Types } from 'mongoose';

export const runtime = 'nodejs';

type RunDoc = {
  _id: Types.ObjectId;
  year: number;
  label: string;
  vendor?: string;
  tool_type?: string;
  start_odometer_ft?: number;
  end_odometer_ft?: number;
  total_features?: number;
};

type FeatureDoc = {
  _id: Types.ObjectId;
  run_id: Types.ObjectId;
  log_distance_ft?: number | null;
  corrected_distance_ft?: number | null;
  event_type_canonical: string;
  event_type_raw?: string;
  depth_percent?: number | null;
  depth_in?: number | null;
  length_in?: number | null;
  width_in?: number | null;
  clock_decimal?: number | null;
  clock_position_raw?: string;
  joint_number?: number | null;
  is_reference_point?: boolean;
};

type StandardsApplied = {
  asme_b31_8s?: {
    applied?: boolean;
    interaction_zone?: boolean;
    interaction_severity?: string | null;
    severity_level?: string;
    repair_recommendation?: string;
    rationale?: string;
  };
  api_1163?: {
    applied?: boolean;
    tool_weight?: number;
    adjusted_confidence?: number;
    adjustment_reason?: string;
  };
  nace_sp0502?: {
    applied?: boolean;
    corrosion_class?: string;
    remaining_life_years?: number | null;
    reassessment_interval_years?: number | null;
  };
  phmsa?: {
    audit_logged?: boolean;
    decision_rationale?: string;
  };
};

type MatchDoc = {
  _id: Types.ObjectId;
  run_a_feature_id: Types.ObjectId;
  run_b_feature_id: Types.ObjectId;
  run_a_run_id: Types.ObjectId;
  run_b_run_id: Types.ObjectId;
  confidence_score: number;
  confidence_category: string;
  match_category: string;
  distance_residual_ft: number;
  depth_growth_pct_yr?: number;
  standards_applied?: StandardsApplied;
  ml_augmentation?: {
    adjusted_score?: number;
    ml_confidence?: number;
    model_id?: string;
    model_version?: string;
    explanation?: string;
    experimental?: boolean;
  };
};

type JobDoc = {
  _id: Types.ObjectId;
  dataset_id: Types.ObjectId;
  run_pair_ids?: Array<{ older_run_id: Types.ObjectId; newer_run_id: Types.ObjectId }>;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  await connectToDatabase();

  const job = await AlignmentJob.findOne({ _id: id, org_id: session.user.orgId }).lean<JobDoc | null>();
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Get all run IDs from the dataset
  const { Dataset } = await import('@/lib/db/models');
  const dataset = await Dataset.findById(job.dataset_id).lean<{ run_ids: Types.ObjectId[] } | null>();
  if (!dataset) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }

  // Get runs sorted by year
  const runs = await Run.find({ _id: { $in: dataset.run_ids } })
    .sort({ year: 1 })
    .lean<RunDoc[]>();

  // Get all features for these runs (select only what we need for rendering)
  const runIds = runs.map((r) => r._id);
  const features = await Feature.find({ run_id: { $in: runIds } })
    .select({
      run_id: 1,
      log_distance_ft: 1,
      corrected_distance_ft: 1,
      event_type_canonical: 1,
      event_type_raw: 1,
      depth_percent: 1,
      depth_in: 1,
      length_in: 1,
      width_in: 1,
      clock_decimal: 1,
      clock_position_raw: 1,
      joint_number: 1,
      is_reference_point: 1
    })
    .lean<FeatureDoc[]>();

  // Get matches for this job
  const matches = await MatchedPair.find({ job_id: id })
    .select({
      run_a_feature_id: 1,
      run_b_feature_id: 1,
      run_a_run_id: 1,
      run_b_run_id: 1,
      confidence_score: 1,
      confidence_category: 1,
      match_category: 1,
      distance_residual_ft: 1,
      depth_growth_pct_yr: 1,
      standards_applied: 1,
      ml_augmentation: 1
    })
    .lean<MatchDoc[]>();

  // Get exceptions
  const exceptions = await Exception.find({ job_id: id, category: 'UNMATCHED' })
    .select({ feature_id: 1, run_id: 1, severity: 1 })
    .lean<Array<{ feature_id: Types.ObjectId; run_id: Types.ObjectId; severity: string }>>();

  // Build matched feature IDs set
  const matchedFeatureIds = new Set<string>();
  for (const m of matches) {
    matchedFeatureIds.add(m.run_a_feature_id.toString());
    matchedFeatureIds.add(m.run_b_feature_id.toString());
  }

  // Build unmatched feature IDs set
  const unmatchedFeatureIds = new Set<string>();
  for (const e of exceptions) {
    if (e.feature_id) unmatchedFeatureIds.add(e.feature_id.toString());
  }

  // Determine baseline (newest run)
  const baselineRunId = runs[runs.length - 1]?._id.toString();

  // Group features by run and annotate
  const featuresByRun = new Map<string, typeof features>();
  for (const f of features) {
    const runId = f.run_id.toString();
    if (!featuresByRun.has(runId)) featuresByRun.set(runId, []);
    featuresByRun.get(runId)!.push(f);
  }

  // Build match map: feature_id → matched partner feature IDs + standards data
  const matchMap = new Map<string, { partnerId: string; score: number; category: string; residualFt: number; growthPctYr?: number; standards?: StandardsApplied; mlAugmentation?: MatchDoc['ml_augmentation'] }>();
  for (const m of matches) {
    matchMap.set(m.run_a_feature_id.toString(), {
      partnerId: m.run_b_feature_id.toString(),
      score: m.confidence_score,
      category: m.confidence_category,
      residualFt: m.distance_residual_ft,
      growthPctYr: m.depth_growth_pct_yr,
      standards: m.standards_applied,
      mlAugmentation: m.ml_augmentation
    });
    matchMap.set(m.run_b_feature_id.toString(), {
      partnerId: m.run_a_feature_id.toString(),
      score: m.confidence_score,
      category: m.confidence_category,
      residualFt: m.distance_residual_ft,
      growthPctYr: m.depth_growth_pct_yr,
      standards: m.standards_applied,
      mlAugmentation: m.ml_augmentation
    });
  }

  // Compute global distance range for uniform scale
  let globalMin = Infinity;
  let globalMax = -Infinity;
  for (const f of features) {
    const d = f.corrected_distance_ft ?? f.log_distance_ft ?? 0;
    if (d < globalMin) globalMin = d;
    if (d > globalMax) globalMax = d;
  }

  // Build output
  const runsOut = runs.map((run, index) => {
    const runId = run._id.toString();
    const isBaseline = runId === baselineRunId;
    const runFeatures = featuresByRun.get(runId) ?? [];

    // Sort by corrected distance
    runFeatures.sort((a, b) => (a.corrected_distance_ft ?? a.log_distance_ft ?? 0) - (b.corrected_distance_ft ?? b.log_distance_ft ?? 0));

    return {
      runId,
      year: run.year,
      label: run.label,
      vendor: run.vendor,
      isBaseline,
      runIndex: index,
      driftLabel: isBaseline ? 'Baseline' : index === 0 ? 'More Drift' : 'Drifted',
      features: runFeatures.map((f) => {
        const fid = f._id.toString();
        const match = matchMap.get(fid);
        const isUnmatched = unmatchedFeatureIds.has(fid);
        const isNew = isUnmatched && !isBaseline;

        return {
          id: fid,
          distance: f.corrected_distance_ft ?? f.log_distance_ft ?? 0,
          originalDistance: f.log_distance_ft ?? 0,
          drift: (f.corrected_distance_ft ?? f.log_distance_ft ?? 0) - (f.log_distance_ft ?? 0),
          type: f.event_type_canonical,
          typeRaw: f.event_type_raw,
          depthPercent: f.depth_percent,
          depthIn: f.depth_in,
          lengthIn: f.length_in,
          widthIn: f.width_in,
          clockDecimal: f.clock_decimal,
          clockRaw: f.clock_position_raw,
          jointNumber: f.joint_number,
          isReferencePoint: f.is_reference_point ?? false,
          matchStatus: match ? 'matched' : isNew ? 'new' : isUnmatched ? 'missing' : 'unlinked',
          matchInfo: match ?? null
        };
      })
    };
  });

  // ── Visibility Confidence Gating ──
  // Compute visibility state for every feature (post-alignment, pre-render).
  // No data is deleted — only visibility metadata is added.
  const partnerMapForVisibility = new Map<string, string>();
  for (const m of matches) {
    partnerMapForVisibility.set(m.run_a_feature_id.toString(), m.run_b_feature_id.toString());
    partnerMapForVisibility.set(m.run_b_feature_id.toString(), m.run_a_feature_id.toString());
  }

  const runsForVisibility = runsOut.map((r) => ({
    runId: r.runId,
    isBaseline: r.isBaseline,
    features: r.features.map((f): FeatureForVisibility => ({
      id: f.id,
      type: f.type,
      distance: f.distance,
      isReferencePoint: f.isReferencePoint,
      matchStatus: f.matchStatus,
      matchScore: f.matchInfo?.score ?? null,
      depthPercent: f.depthPercent,
      depthIn: f.depthIn,
      lengthIn: f.lengthIn,
      widthIn: f.widthIn,
      clockDecimal: f.clockDecimal,
    })),
  }));

  const visibilityMap = computeVisibility(
    runsForVisibility,
    partnerMapForVisibility,
    runs.length,
    baselineRunId
  );

  // ── Refinement Overrides ──
  // Load post-matching refinement exceptions and apply visibility overrides.
  // NEIGHBORHOOD_EXCESS → force hidden (likely split/duplicate)
  // RUN3_UNSUPPORTED    → force dimmed (no match + sparse data)
  const refinementExceptions = await Exception.find({
    job_id: id,
    category: { $in: ['NEIGHBORHOOD_EXCESS', 'RUN3_UNSUPPORTED'] }
  })
    .select({ feature_id: 1, category: 1, details: 1 })
    .lean<Array<{ feature_id: Types.ObjectId; category: string; details: Record<string, unknown> }>>();

  for (const exc of refinementExceptions) {
    if (!exc.feature_id) continue;
    const fid = exc.feature_id.toString();
    const existing = visibilityMap.get(fid);
    if (!existing) continue;

    const reason = (exc.details?.reason as string) ?? exc.category;

    if (exc.category === 'NEIGHBORHOOD_EXCESS') {
      // Force hidden — likely duplicate of a matched feature
      if (existing.visibilityState !== 'hidden') {
        visibilityMap.set(fid, {
          ...existing,
          visibilityState: 'hidden',
          visibilityScore: Math.min(existing.visibilityScore, 25),
          reasons: [...existing.reasons, `Suppressed: ${reason}`],
        });
      }
    } else if (exc.category === 'RUN3_UNSUPPORTED') {
      // Force dimmed — no match and insufficient data
      if (existing.visibilityState === 'full') {
        visibilityMap.set(fid, {
          ...existing,
          visibilityState: 'dimmed',
          visibilityScore: Math.min(existing.visibilityScore, 50),
          reasons: [...existing.reasons, `Flagged: ${reason}`],
        });
      }
    }
  }

  // Attach visibility audit to each feature
  const runsWithVisibility = runsOut.map((r) => ({
    ...r,
    features: r.features.map((f) => ({
      ...f,
      visibility: visibilityMap.get(f.id) ?? {
        visibilityScore: 100,
        visibilityState: 'full' as const,
        components: { matchConfidence: 100, temporalPersistence: 100, spatialReinforcement: 100, dataCompleteness: 100 },
        reasons: ['Default: no visibility data computed'],
      },
    })),
  }));

  // Compute visibility summary stats
  let fullCount = 0;
  let dimmedCount = 0;
  let hiddenCount = 0;
  for (const [, audit] of visibilityMap) {
    if (audit.visibilityState === 'full') fullCount++;
    else if (audit.visibilityState === 'dimmed') dimmedCount++;
    else hiddenCount++;
  }

  return NextResponse.json({
    runs: runsWithVisibility,
    distanceRange: { min: globalMin === Infinity ? 0 : globalMin, max: globalMax === -Infinity ? 0 : globalMax },
    totalMatches: matches.length,
    baselineRunId,
    visibilitySummary: {
      full: fullCount,
      dimmed: dimmedCount,
      hidden: hiddenCount,
      total: fullCount + dimmedCount + hiddenCount,
    },
  });
}
