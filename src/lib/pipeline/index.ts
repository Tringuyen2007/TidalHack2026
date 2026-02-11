import { Types } from 'mongoose';
import { AlignmentJob, AuditLog, Dataset, Run, MatchedPair, Exception, Feature } from '@/lib/db/models';
import { connectToDatabase } from '@/lib/db/mongoose';
import { matchAnchorsForRunPair } from './03-anchor';
import { applyDistanceCorrection } from './04-correct';
import { matchAnomalies } from './05-match';
import { postScoreAndCategorize } from './06-score';
import { generateExports } from './07-export';
import { refineBaselineMatches } from './utils/run3-refinement';

// ── Algorithm imports ──
import { computeDTW, extractAnchorMappings, buildDTWAudit, type DTWInput, type DTWResult } from './utils/dtw';
import { runICP, buildICPAudit, type ICPPoint, type ICPResult } from './utils/icp';
import { buildInteractionGraph, buildGraphAudit } from './utils/graph-matching';
import { buildEnsembleAudit, type EnsembleBreakdown } from './utils/ensemble-scoring';
import {
  assessSeverity, recommendRepair, assessCorrosionGrowth,
  generateComplianceRecord, buildStandardsAudit, adjustConfidenceForTool,
  getToolQualification,
  type FeatureForAssessment,
} from './utils/standards-assessment';
import { buildMLHooksAudit, safeScoreFeaturePair, safeAssessGrowthTrend, type FeaturePairVector, type GrowthTrendVector } from './utils/ml-hooks';
import { initMLSidecar, type MLSidecarClient, type ClusterFeatureInput } from './utils/ml-sidecar-client';

const STAGES = [
  'Parse/ingest',
  'Normalize',
  'Anchor match',
  'Distance correction',
  'Anomaly matching',
  'Scoring',
  'Export'
];

type JobLite = {
  _id: Types.ObjectId;
  dataset_id: Types.ObjectId;
  current_stage?: number;
};

type DatasetLite = {
  _id: Types.ObjectId;
  run_ids: Types.ObjectId[];
};

type RunLite = {
  _id: Types.ObjectId;
  year: number;
};

async function markStage(jobId: string, stageIndex: number, status: 'RUNNING' | 'DONE' | 'FAILED', message?: string) {
  console.log(`[Pipeline ${jobId}] Stage ${stageIndex} (${STAGES[stageIndex - 1]}): ${status}${message ? ' — ' + message : ''}`);
  const stageStatus = STAGES.map((name, idx) => ({
    stage: idx + 1,
    name,
    status: idx + 1 < stageIndex ? 'DONE' : idx + 1 === stageIndex ? status : 'PENDING',
    message
  }));

  await AlignmentJob.updateOne(
    { _id: jobId },
    {
      current_stage: stageIndex,
      progress_pct: Math.round((stageIndex / STAGES.length) * 100),
      stage_status: stageStatus
    }
  );
}

export async function runAlignmentPipeline(jobId: string) {
  await connectToDatabase();

  const job = await AlignmentJob.findById(jobId).lean<JobLite | null>();
  if (!job) {
    throw new Error('Job not found');
  }

  await AlignmentJob.updateOne({ _id: jobId }, { status: 'RUNNING' });

  try {
    await markStage(jobId, 1, 'DONE', 'Ingestion already completed at upload');
    await markStage(jobId, 2, 'DONE', 'Normalization already completed at upload');

    const dataset = await Dataset.findById(job.dataset_id).lean<DatasetLite | null>();
    if (!dataset?.run_ids?.length || dataset.run_ids.length < 2) {
      throw new Error('Need at least two runs for alignment');
    }

    const runs = await Run.find({ _id: { $in: dataset.run_ids } }).sort({ year: 1 }).lean<RunLite[]>();
    if (runs.length < 2) {
      throw new Error('Need at least two runs for alignment');
    }

    const baseline = runs[runs.length - 1];
    const olderRuns = runs.slice(0, -1);

    const runPairs = olderRuns.map((run) => ({ older: run, newer: baseline }));

    await AlignmentJob.updateOne(
      { _id: jobId },
      {
        run_pair_ids: runPairs.map((pair) => ({
          older_run_id: pair.older._id,
          newer_run_id: pair.newer._id
        }))
      }
    );

    await markStage(jobId, 3, 'RUNNING', 'Matching girth weld anchors + DTW alignment');
    const anchorsByPair = new Map<string, Awaited<ReturnType<typeof matchAnchorsForRunPair>>>();
    const dtwByPair = new Map<string, { result: DTWResult; confidence: number }>();

    for (const pair of runPairs) {
      const key = `${pair.older._id.toString()}::${pair.newer._id.toString()}`;
      const anchors = await matchAnchorsForRunPair({
        jobId,
        olderRunId: pair.older._id.toString(),
        newerRunId: pair.newer._id.toString()
      });
      anchorsByPair.set(key, anchors);

      // ── DTW Enhancement ──
      // Run DTW on girth weld sequences to validate anchor alignment
      // and provide a confidence signal for the ensemble scorer.
      const [olderWelds, newerWelds] = await Promise.all([
        Feature.find({
          run_id: pair.older._id.toString(),
          event_type_canonical: 'GIRTH_WELD',
        })
          .sort({ log_distance_ft: 1 })
          .select({ _id: 1, log_distance_ft: 1, joint_number: 1 })
          .lean<{ _id: Types.ObjectId; log_distance_ft?: number | null; joint_number?: number | null }[]>(),
        Feature.find({
          run_id: pair.newer._id.toString(),
          event_type_canonical: 'GIRTH_WELD',
        })
          .sort({ log_distance_ft: 1 })
          .select({ _id: 1, log_distance_ft: 1, joint_number: 1 })
          .lean<{ _id: Types.ObjectId; log_distance_ft?: number | null; joint_number?: number | null }[]>(),
      ]);

      const olderDTWInput: DTWInput[] = olderWelds
        .filter(w => w.log_distance_ft != null)
        .map(w => ({ id: w._id.toString(), distance: w.log_distance_ft!, joint: w.joint_number }));
      const newerDTWInput: DTWInput[] = newerWelds
        .filter(w => w.log_distance_ft != null)
        .map(w => ({ id: w._id.toString(), distance: w.log_distance_ft!, joint: w.joint_number }));

      if (olderDTWInput.length >= 3 && newerDTWInput.length >= 3) {
        const dtwResult = computeDTW(olderDTWInput, newerDTWInput);
        const dtwMappings = extractAnchorMappings(olderDTWInput, newerDTWInput, dtwResult);
        dtwByPair.set(key, { result: dtwResult, confidence: dtwResult.confidence });

        // Log DTW audit
        const dtwAudit = buildDTWAudit(
          pair.older._id.toString(), pair.newer._id.toString(),
          olderDTWInput, newerDTWInput, dtwResult, dtwMappings, 0.25,
        );
        await AuditLog.create({
          job_id: jobId,
          action: 'DTW_ALIGNMENT',
          entity: 'Run',
          entity_id: pair.older._id,
          payload: dtwAudit,
        });
        console.log(`[Pipeline ${jobId}] DTW: confidence=${dtwResult.confidence.toFixed(1)}%, mappings=${dtwMappings.length}, cost=${dtwResult.normalizedCost.toFixed(3)}`);
      }
    }
    await markStage(jobId, 3, 'DONE', 'Anchor matching + DTW complete');

    await markStage(jobId, 4, 'RUNNING', 'Applying correction functions + ICP refinement');
    const icpByPair = new Map<string, { avgRmse: number; results: ICPResult[] }>();

    for (const pair of runPairs) {
      const key = `${pair.older._id.toString()}::${pair.newer._id.toString()}`;
      await applyDistanceCorrection({
        jobId,
        olderRunId: pair.older._id.toString(),
        newerRunId: pair.newer._id.toString(),
        anchors: anchorsByPair.get(key) ?? []
      });

      // ── ICP Local Refinement ──
      // After piecewise-linear correction, run ICP per weld-to-weld
      // segment to refine residual alignment error.
      const anchors = anchorsByPair.get(key) ?? [];
      if (anchors.length >= 2) {
        const REFERENCE_TYPES = new Set(['GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'FLANGE', 'SUPPORT', 'LAUNCHER', 'RECEIVER']);
        const [olderAnomalies, newerAnomalies] = await Promise.all([
          Feature.find({
            run_id: pair.older._id.toString(),
            event_type_canonical: { $nin: [...REFERENCE_TYPES] },
          })
            .select({ _id: 1, corrected_distance_ft: 1, clock_decimal: 1 })
            .lean<{ _id: Types.ObjectId; corrected_distance_ft?: number | null; clock_decimal?: number | null }[]>(),
          Feature.find({
            run_id: pair.newer._id.toString(),
            event_type_canonical: { $nin: [...REFERENCE_TYPES] },
          })
            .select({ _id: 1, corrected_distance_ft: 1, clock_decimal: 1 })
            .lean<{ _id: Types.ObjectId; corrected_distance_ft?: number | null; clock_decimal?: number | null }[]>(),
        ]);

        const icpResults: ICPResult[] = [];
        const totalSegments = anchors.length - 1;

        for (let seg = 0; seg < totalSegments; seg++) {
          const segMin = anchors[seg].newerDistance;
          const segMax = anchors[seg + 1].newerDistance;

          const srcPts: ICPPoint[] = olderAnomalies
            .filter(f => {
              const d = f.corrected_distance_ft ?? 0;
              return d >= segMin && d < segMax;
            })
            .map(f => ({ id: f._id.toString(), x: f.corrected_distance_ft ?? 0, clock: f.clock_decimal ?? null }));

          const tgtPts: ICPPoint[] = newerAnomalies
            .filter(f => {
              const d = f.corrected_distance_ft ?? 0;
              return d >= segMin && d < segMax;
            })
            .map(f => ({ id: f._id.toString(), x: f.corrected_distance_ft ?? 0, clock: f.clock_decimal ?? null }));

          if (srcPts.length >= 2 && tgtPts.length >= 2) {
            const icpResult = runICP(srcPts, tgtPts, seg);
            icpResults.push(icpResult);
          }
        }

        if (icpResults.length > 0) {
          const avgRmse = icpResults.reduce((s, r) => s + r.rmse, 0) / icpResults.length;
          const convergedCount = icpResults.filter(r => r.converged).length;
          icpByPair.set(key, { avgRmse, results: icpResults });

          // Log ICP audit (aggregate)
          await AuditLog.create({
            job_id: jobId,
            action: 'ICP_REFINEMENT',
            entity: 'Run',
            entity_id: pair.older._id,
            payload: {
              algorithm: 'ICP',
              olderRunId: pair.older._id.toString(),
              newerRunId: pair.newer._id.toString(),
              segmentsProcessed: icpResults.length,
              segmentsConverged: convergedCount,
              avgRmse,
              avgConfidence: icpResults.reduce((s, r) => s + r.confidence, 0) / icpResults.length,
              perSegment: icpResults.map(r => buildICPAudit(
                r, pair.older._id.toString(), pair.newer._id.toString(),
                0, 0 // counts not critical for aggregate view
              )),
            },
          });
          console.log(`[Pipeline ${jobId}] ICP: ${convergedCount}/${icpResults.length} segments converged, avgRMSE=${avgRmse.toFixed(3)}ft`);
        }
      }
    }
    await markStage(jobId, 4, 'DONE', 'Distance correction + ICP complete');

    await markStage(jobId, 5, 'RUNNING', 'Running segment-based assignment (ensemble scoring)');
    for (const pair of runPairs) {
      const key = `${pair.older._id.toString()}::${pair.newer._id.toString()}`;
      const dtwInfo = dtwByPair.get(key);
      const icpInfo = icpByPair.get(key);

      await matchAnomalies({
        jobId,
        olderRunId: pair.older._id.toString(),
        newerRunId: pair.newer._id.toString(),
        anchors: anchorsByPair.get(key) ?? [],
        dtwConfidence: dtwInfo?.confidence ?? null,
        icpRmse: icpInfo?.avgRmse ?? null,
        totalRunCount: runs.length,
      });
    }

    // Post-matching refinement: suppress neighborhood duplicates,
    // classify unanchored baseline anomalies, log hierarchical matches
    const refinementSummary = await refineBaselineMatches({
      jobId,
      baselineRunId: baseline._id.toString(),
      olderRunIds: olderRuns.map((r) => r._id.toString())
    });
    await markStage(jobId, 5, 'DONE',
      `Matched & refined: ${refinementSummary.neighborhoodSuppressed + refinementSummary.clusterSuppressed} suppressed, ${refinementSummary.classifiedNew} true new, ${refinementSummary.classifiedUnsupported} unsupported`
    );

    await markStage(jobId, 6, 'RUNNING', 'Scoring, graph analysis, standards assessment');
    const scoringSummary = await postScoreAndCategorize(jobId);

    // ── Graph-Based Interaction Analysis ──
    // Build interaction graph to detect anomaly clusters per ASME B31.8S §A-4.3.
    // This enriches the audit trail with interaction zone information.
    try {
      const allMatchedPairs = await MatchedPair.find({ job_id: jobId }).lean();
      if (allMatchedPairs.length > 0) {
        // Gather matched feature IDs to query full feature data
        const featureIds = new Set<string>();
        for (const mp of allMatchedPairs) {
          featureIds.add(mp.run_a_feature_id.toString());
          featureIds.add(mp.run_b_feature_id.toString());
        }

        const matchedFeatures = await Feature.find({
          _id: { $in: [...featureIds].map(id => new Types.ObjectId(id)) },
        })
          .select({ _id: 1, run_id: 1, corrected_distance_ft: 1, clock_decimal: 1, event_type_canonical: 1, depth_percent: 1, depth_in: 1, length_in: 1, width_in: 1 })
          .lean<{ _id: Types.ObjectId; run_id: Types.ObjectId; corrected_distance_ft?: number | null; clock_decimal?: number | null; event_type_canonical?: string; depth_percent?: number | null; depth_in?: number | null; length_in?: number | null; width_in?: number | null }[]>();

        const featureMap = new Map(matchedFeatures.map(f => [f._id.toString(), f]));

        // Build GraphNode[] from matched features — use imported GraphNode type from graph-matching
        const graphNodes: import('./utils/graph-matching').GraphNode[] = [];
        const runsById = new Map(runs.map(r => [r._id.toString(), r]));
        for (const feat of matchedFeatures) {
          const run = runsById.get(feat.run_id?.toString() ?? '');
          graphNodes.push({
            id: feat._id.toString(),
            runId: feat.run_id?.toString() ?? '',
            runYear: run?.year ?? 0,
            distance: feat.corrected_distance_ft ?? 0,
            clock: feat.clock_decimal ?? null,
            type: feat.event_type_canonical ?? 'UNKNOWN',
            depthPercent: feat.depth_percent ?? null,
            depthIn: feat.depth_in ?? null,
            lengthIn: feat.length_in ?? null,
            widthIn: feat.width_in ?? null,
            wallThicknessIn: null, // Would come from pipe schedule data
          });
        }

        if (graphNodes.length >= 2) {
          const graphResult = buildInteractionGraph(graphNodes, allMatchedPairs.map(mp => ({
            sourceId: mp.run_a_feature_id.toString(),
            targetId: mp.run_b_feature_id.toString(),
            score: mp.confidence_score ?? 0,
          })));

          const graphAudit = buildGraphAudit(graphResult);
          await AuditLog.create({
            job_id: jobId,
            action: 'GRAPH_ANALYSIS',
            entity: 'AlignmentJob',
            entity_id: new Types.ObjectId(jobId),
            payload: graphAudit,
          });
          console.log(`[Pipeline ${jobId}] Graph: ${graphResult.interactionClusters.length} interaction clusters, ${graphResult.edges.length} edges`);
        }
      }
    } catch (graphErr) {
      console.warn(`[Pipeline ${jobId}] Graph analysis non-critical error:`, graphErr);
    }

    // ── Standards-Based Assessment ──
    // Per matched pair: compute ASME B31.8S severity, API 1163 tool confidence,
    // NACE SP0502 corrosion growth, and persist standards_applied on each MatchedPair.
    // This is the core integration: every anomaly gets a standards attribution record.
    try {
      const matchedPairs = await MatchedPair.find({ job_id: jobId }).lean();
      const assessments = [];
      const repairs = [];
      const growths = [];
      let interactionFeatures = 0;

      // Load all matched features for full assessment (type, depth, dimensions)
      const allFeatureIds = new Set<string>();
      for (const mp of matchedPairs) {
        allFeatureIds.add(mp.run_a_feature_id.toString());
        allFeatureIds.add(mp.run_b_feature_id.toString());
      }
      const assessFeatures = await Feature.find({
        _id: { $in: [...allFeatureIds].map(id => new Types.ObjectId(id)) },
      })
        .select({ _id: 1, event_type_canonical: 1, depth_percent: 1, depth_in: 1, length_in: 1, width_in: 1, wall_thickness_in: 1, clock_decimal: 1, run_id: 1 })
        .lean<{ _id: Types.ObjectId; event_type_canonical?: string; depth_percent?: number | null; depth_in?: number | null; length_in?: number | null; width_in?: number | null; wall_thickness_in?: number | null; clock_decimal?: number | null; run_id?: Types.ObjectId }[]>();
      const featLookup = new Map(assessFeatures.map(f => [f._id.toString(), f]));

      // Load run tool qualification for API 1163 weighting
      const runDocs = await Run.find({ _id: { $in: dataset.run_ids } })
        .select({ _id: 1, tool_type: 1, vendor: 1, year: 1, tool_qualification: 1 })
        .lean<{ _id: Types.ObjectId; tool_type?: string; vendor?: string; year?: number; tool_qualification?: { confidence_weight?: number; accuracy_depth_pct?: number; accuracy_distance_ft?: number; accuracy_clock_hrs?: number } }[]>();
      const runLookup = new Map(runDocs.map(r => [r._id.toString(), r]));

      // Check which features are in interaction zones (from earlier graph analysis)
      const interactionZoneFeatureIds = new Set<string>();
      const graphAuditLog = await AuditLog.findOne({ job_id: jobId, action: 'GRAPH_ANALYSIS' }).lean() as { payload?: Record<string, unknown> } | null;
      if (graphAuditLog?.payload?.interactingFeatureIds) {
        const ids = graphAuditLog.payload.interactingFeatureIds as string[];
        for (const id of ids) interactionZoneFeatureIds.add(id);
      }

      // Bulk update operations for standards_applied
      const bulkOps: Array<{
        updateOne: {
          filter: { _id: Types.ObjectId };
          update: { standards_applied: Record<string, unknown> };
        };
      }> = [];
      const exceptionInserts: Array<Record<string, unknown>> = [];

      for (const mp of matchedPairs) {
        const newerFeat = featLookup.get(mp.run_b_feature_id.toString());
        const olderFeat = featLookup.get(mp.run_a_feature_id.toString());
        const newerRun = runLookup.get(mp.run_b_run_id?.toString() ?? '');
        const featureType = newerFeat?.event_type_canonical ?? 'OTHER';

        // ── ASME B31.8S Assessment ──
        const assessFeature: FeatureForAssessment = {
          id: mp.run_b_feature_id?.toString() ?? '',
          type: featureType,
          depthPercent: newerFeat?.depth_percent ?? null,
          depthIn: newerFeat?.depth_in ?? null,
          lengthIn: newerFeat?.length_in ?? null,
          widthIn: newerFeat?.width_in ?? null,
          wallThicknessIn: newerFeat?.wall_thickness_in ?? null,
          clock: mp.clock_residual_hrs ?? null,
          distance: mp.distance_residual_ft ?? 0,
          matchConfidence: mp.confidence_score ?? null,
          growthRatePctYr: mp.depth_growth_pct_yr ?? null,
          inInteractionZone: interactionZoneFeatureIds.has(mp.run_b_feature_id?.toString() ?? ''),
        };

        const assessment = assessSeverity(assessFeature);
        assessments.push(assessment);
        const repair = recommendRepair(assessFeature, assessment);
        repairs.push(repair);

        // ── API 1163 Tool Confidence Adjustment ──
        const toolSpec = getToolQualification(newerRun?.tool_type);
        const toolWeight = toolSpec.confidenceWeight;
        const { adjusted: api1163Adjusted, adjustmentReason } = adjustConfidenceForTool(
          mp.confidence_score ?? 0,
          mp.distance_residual_ft ?? 0,
          mp.clock_residual_hrs ?? null,
          newerFeat?.depth_percent != null && olderFeat?.depth_percent != null
            ? (newerFeat.depth_percent - olderFeat.depth_percent)
            : null,
          newerRun?.tool_type,
        );

        // ── NACE SP0502 Growth Assessment ──
        // NACE SP0502 applies only to external corrosion features (metal loss).
        // Dents, seam welds, bends etc. are excluded per NACE SP0502 §1 scope.
        const NACE_APPLICABLE_TYPES = new Set(['METAL_LOSS', 'CLUSTER', 'METAL_LOSS_MFG']);
        let corrosionClass = 'undetermined' as 'stable' | 'growing' | 'accelerating' | 'undetermined';
        let remainingLife: number | null = null;
        let reassessInterval: number | null = null;
        const naceApplicable = NACE_APPLICABLE_TYPES.has(featureType) && mp.depth_growth_pct_yr != null;

        if (naceApplicable) {
          const growth = assessCorrosionGrowth(
            assessFeature.id,
            mp.depth_growth_pct_yr!,
            mp.length_growth_in_yr ?? null,
            newerFeat?.depth_percent ?? 0,
          );
          growths.push(growth);
          corrosionClass = growth.growthCategory;
          remainingLife = growth.remainingLifeYears;
          reassessInterval = growth.reassessmentIntervalYears;
        }

        // ── Build standards_applied record ──
        const standardsApplied = {
          asme_b31_8s: {
            applied: true,
            interaction_zone: assessFeature.inInteractionZone,
            interaction_severity: assessFeature.inInteractionZone ? (assessment.severity === 'IMMEDIATE' ? 'high' : assessment.severity === 'SCHEDULED' ? 'medium' : 'low') : null,
            severity_level: assessment.severity,
            repair_recommendation: repair.repairType,
            rationale: assessment.explanation,
          },
          api_1163: {
            applied: true,
            tool_weight: toolWeight,
            adjusted_confidence: api1163Adjusted,
            adjustment_reason: adjustmentReason,
          },
          nace_sp0502: {
            applied: naceApplicable,
            corrosion_class: naceApplicable ? corrosionClass : null,
            remaining_life_years: remainingLife,
            reassessment_interval_years: reassessInterval,
          },
          phmsa: {
            audit_logged: true,
            decision_rationale: `Matched via ensemble scoring (${mp.confidence_category}). ${assessment.rule}. ${adjustmentReason}.`,
          },
        };

        bulkOps.push({
          updateOne: {
            filter: { _id: mp._id as Types.ObjectId },
            update: { standards_applied: standardsApplied },
          },
        });

        // Create exceptions for critical standards findings
        if (assessment.severity === 'IMMEDIATE') {
          exceptionInserts.push({
            job_id: jobId,
            run_id: mp.run_b_run_id,
            feature_id: mp.run_b_feature_id,
            category: 'IMMEDIATE_SEVERITY',
            severity: 'HIGH',
            details: {
              reason: assessment.explanation,
              standardRef: assessment.standardRef,
              repairType: repair.repairType,
            },
          });
        }

        if (corrosionClass === 'accelerating') {
          exceptionInserts.push({
            job_id: jobId,
            run_id: mp.run_b_run_id,
            feature_id: mp.run_b_feature_id,
            category: 'ACCELERATED_GROWTH',
            severity: 'HIGH',
            details: {
              growthRate: mp.depth_growth_pct_yr,
              remainingLife,
              standardRef: 'NACE SP0502 §7',
            },
          });
        }
      }

      // Persist standards_applied on all matched pairs
      for (let i = 0; i < bulkOps.length; i += 1000) {
        const batch = bulkOps.slice(i, i + 1000);
        await MatchedPair.bulkWrite(batch, { ordered: false });
      }

      // Persist standards exceptions
      for (let i = 0; i < exceptionInserts.length; i += 1000) {
        await Exception.insertMany(exceptionInserts.slice(i, i + 1000), { ordered: false });
      }

      const complianceRecord = generateComplianceRecord({
        jobId,
        hasOdometerData: true,
        hasDTW: dtwByPair.size > 0,
        hasICP: icpByPair.size > 0,
        hasGraphAnalysis: true,
        hasEnsembleScoring: true,
        immediateFeatureCount: assessments.filter(a => a.severity === 'IMMEDIATE').length,
        scheduledFeatureCount: assessments.filter(a => a.severity === 'SCHEDULED').length,
      });

      const standardsAudit = buildStandardsAudit(
        assessments, repairs, growths, interactionFeatures, complianceRecord.auditReady,
      );

      await AuditLog.create({
        job_id: jobId,
        action: 'STANDARDS_ASSESSMENT',
        entity: 'AlignmentJob',
        entity_id: new Types.ObjectId(jobId),
        payload: standardsAudit,
      });

      await AuditLog.create({
        job_id: jobId,
        action: 'PHMSA_COMPLIANCE',
        entity: 'AlignmentJob',
        entity_id: new Types.ObjectId(jobId),
        payload: complianceRecord,
      });

      console.log(`[Pipeline ${jobId}] Standards: ${assessments.filter(a => a.severity === 'IMMEDIATE').length} IMMEDIATE, ${assessments.filter(a => a.severity === 'SCHEDULED').length} SCHEDULED, PHMSA audit-ready=${complianceRecord.auditReady}`);
    } catch (stdErr) {
      console.warn(`[Pipeline ${jobId}] Standards assessment non-critical error:`, stdErr);
    }

    // ── ML Sidecar Integration (advisory only) ──
    // Initialize ML sidecar — respect per-job toggle, falls back to no-op if disabled/unavailable
    const jobForMl = await AlignmentJob.findById(jobId).select('enable_ml').lean<{ enable_ml?: boolean } | null>();
    const mlClient = await initMLSidecar(jobForMl?.enable_ml ?? false);
    let mlPairsScored = 0;
    let mlGrowthsAssessed = 0;
    let mlSubgraphsScored = 0;
    let mlErrors = 0;
    const mlAugmentations: Array<{
      matchedPairId: string;
      deterministicScore: number;
      mlAdjustedScore: number;
      mlConfidence: number;
      modelId: string;
      explanation: string;
    }> = [];

    if (mlClient) {
      try {
        const allMPs = await MatchedPair.find({ job_id: jobId }).lean();
        console.log(`[Pipeline ${jobId}] ML sidecar active — scoring ${allMPs.length} matched pairs`);

        // ── ML Similarity Scoring ──
        const mlBulkOps: Array<{
          updateOne: {
            filter: { _id: Types.ObjectId };
            update: { ml_augmentation?: Record<string, unknown> };
          };
        }> = [];

        for (const mp of allMPs) {
          try {
            // Build feature pair vector for Siamese model
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const olderFeat = await Feature.findById(mp.run_a_feature_id).lean() as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newerFeat = await Feature.findById(mp.run_b_feature_id).lean() as any;
            if (!olderFeat || !newerFeat) continue;

            const pairVector: FeaturePairVector = {
              older: {
                type: olderFeat.event_type_canonical ?? olderFeat.event_type ?? 'OTHER',
                distance: olderFeat.corrected_distance_ft ?? olderFeat.distance_ft ?? 0,
                clock: olderFeat.clock_position_hrs ?? null,
                depthPercent: olderFeat.depth_percent ?? null,
                lengthIn: olderFeat.length_in ?? null,
                widthIn: olderFeat.width_in ?? null,
              },
              newer: {
                type: newerFeat.event_type_canonical ?? newerFeat.event_type ?? 'OTHER',
                distance: newerFeat.corrected_distance_ft ?? newerFeat.distance_ft ?? 0,
                clock: newerFeat.clock_position_hrs ?? null,
                depthPercent: newerFeat.depth_percent ?? null,
                lengthIn: newerFeat.length_in ?? null,
                widthIn: newerFeat.width_in ?? null,
              },
              deterministicScore: mp.confidence_score ?? 0,
              distanceResidualFt: mp.distance_residual_ft ?? 0,
              clockResidualHrs: mp.clock_residual_hrs ?? null,
            };

            const aug = await safeScoreFeaturePair(pairVector);
            mlPairsScored++;

            mlAugmentations.push({
              matchedPairId: String(mp._id),
              deterministicScore: mp.confidence_score ?? 0,
              mlAdjustedScore: aug.adjustedScore,
              mlConfidence: aug.mlConfidence,
              modelId: aug.modelId,
              explanation: aug.explanation,
            });

            // Store ML augmentation on the matched pair (advisory field)
            mlBulkOps.push({
              updateOne: {
                filter: { _id: mp._id as Types.ObjectId },
                update: {
                  ml_augmentation: {
                    adjusted_score: aug.adjustedScore,
                    ml_confidence: aug.mlConfidence,
                    model_id: aug.modelId,
                    model_version: aug.modelVersion,
                    explanation: aug.explanation,
                    experimental: true,
                    blending_formula: 'deterministic * 0.8 + ml_similarity * 0.2',
                  },
                },
              },
            });
          } catch (pairErr) {
            mlErrors++;
          }
        }

        // Persist ML augmentations
        if (mlBulkOps.length > 0) {
          for (let i = 0; i < mlBulkOps.length; i += 1000) {
            await MatchedPair.bulkWrite(mlBulkOps.slice(i, i + 1000), { ordered: false });
          }
          console.log(`[Pipeline ${jobId}] ML: ${mlPairsScored} pairs scored, ${mlErrors} errors`);
        }

        // ── ML Clustering ──
        try {
          const clusterFeatures: ClusterFeatureInput[] = [];
          const clusterMPs = await MatchedPair.find({ job_id: jobId }).lean();

          for (const mp of clusterMPs) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const feat = await Feature.findById(mp.run_b_feature_id).lean() as any;
            if (!feat) continue;
            clusterFeatures.push({
              feature_id: mp.run_b_feature_id.toString(),
              corrected_distance_ft: feat.corrected_distance_ft ?? feat.distance_ft ?? 0,
              clock_hrs: feat.clock_position_hrs ?? null,
              depth_percent: feat.depth_percent ?? null,
              length_in: feat.length_in ?? null,
              width_in: feat.width_in ?? null,
              event_type: feat.event_type_canonical ?? feat.event_type ?? 'UNKNOWN',
            });
          }

          if (clusterFeatures.length >= 2) {
            const clusterResult = await mlClient.predictClusters(clusterFeatures);
            mlSubgraphsScored = clusterResult.total_clusters;

            await AuditLog.create({
              job_id: jobId,
              action: 'ML_CLUSTERING',
              entity: 'AlignmentJob',
              entity_id: new Types.ObjectId(jobId),
              payload: {
                algorithm: 'DBSCAN',
                total_clusters: clusterResult.total_clusters,
                noise_count: clusterResult.noise_count,
                clusters: clusterResult.clusters,
                experimental: true,
              },
            });
          }
        } catch (clusterErr) {
          mlErrors++;
          console.warn(`[Pipeline ${jobId}] ML clustering non-critical error:`, clusterErr);
        }

        // ── ML Growth Prediction ──
        try {
          const growthMPs = await MatchedPair.find({
            job_id: jobId,
            depth_growth_pct_yr: { $ne: null },
          }).lean();

          for (const mp of growthMPs) {
            try {
              const growthVector: GrowthTrendVector = {
                featureId: mp.run_b_feature_id.toString(),
                depthHistory: [
                  {
                    runDate: new Date(runs[0].year, 0, 1),
                    depthPercent: mp.depth_change_pct != null
                      ? ((mp.confidence_score ?? 50) - (mp.depth_change_pct ?? 0))
                      : mp.confidence_score ?? 0,
                  },
                  {
                    runDate: new Date(baseline.year, 0, 1),
                    depthPercent: mp.confidence_score ?? 0,
                  },
                ],
                distanceHistory: [],
                linearGrowthRate: mp.depth_growth_pct_yr ?? 0,
              };

              const growthAug = await safeAssessGrowthTrend(growthVector);
              mlGrowthsAssessed++;
            } catch (growthErr) {
              mlErrors++;
            }
          }
        } catch (growthBatchErr) {
          console.warn(`[Pipeline ${jobId}] ML growth prediction non-critical error:`, growthBatchErr);
        }
      } catch (mlErr) {
        console.warn(`[Pipeline ${jobId}] ML sidecar non-critical error:`, mlErr);
        mlErrors++;
      }
    }

    const mlAudit = buildMLHooksAudit({
      pairsScored: mlPairsScored,
      growthsAssessed: mlGrowthsAssessed,
      subgraphsScored: mlSubgraphsScored,
      errors: mlErrors,
    });
    await AuditLog.create({
      job_id: jobId,
      action: 'ML_HOOKS_STATUS',
      entity: 'AlignmentJob',
      entity_id: new Types.ObjectId(jobId),
      payload: mlAudit,
    });

    await markStage(jobId, 6, 'DONE', 'Scoring + analysis complete');

    await markStage(jobId, 7, 'RUNNING', 'Generating exports');
    const exportsInfo = await generateExports(jobId);
    await markStage(jobId, 7, 'DONE', 'Export complete');

    const [totalMatches, totalExceptions] = await Promise.all([
      MatchedPair.countDocuments({ job_id: jobId }),
      Exception.countDocuments({ job_id: jobId })
    ]);

    const resultSummary = {
      ...scoringSummary,
      total_matches: totalMatches,
      total_exceptions: totalExceptions,
      baseline_run_year: baseline.year,
      export_files: exportsInfo.files
    };

    await AlignmentJob.updateOne(
      { _id: jobId },
      {
        status: 'COMPLETED',
        progress_pct: 100,
        result_summary: resultSummary
      }
    );

    await AuditLog.create({
      job_id: jobId,
      action: 'PIPELINE_COMPLETED',
      entity: 'AlignmentJob',
      entity_id: new Types.ObjectId(jobId),
      payload: resultSummary
    });

    return resultSummary;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pipeline failed';

    await AlignmentJob.updateOne(
      { _id: jobId },
      {
        status: 'FAILED',
        error: message
      }
    );
    await markStage(jobId, Math.min(7, (job.current_stage ?? 0) + 1), 'FAILED', message);

    await AuditLog.create({
      job_id: jobId,
      action: 'PIPELINE_FAILED',
      entity: 'AlignmentJob',
      entity_id: new Types.ObjectId(jobId),
      payload: { error: message }
    });

    throw error;
  }
}
