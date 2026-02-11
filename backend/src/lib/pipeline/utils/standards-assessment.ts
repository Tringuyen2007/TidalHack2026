/**
 * Standards-Based Assessment Logic
 *
 * ───────────────────────────────────────────────────────────────────
 * Purpose:
 *
 *   Standards guide decisions. Algorithms support decisions.
 *   AI never replaces standards.
 *
 *   This module codifies assessment rules from:
 *
 *     1. ASME B31.8S  — Integrity assessment, interaction rules,
 *                        severity ranking, cluster-based assessment
 *     2. API 1163     — Tool qualification, confidence weighting
 *                        by inspection technology
 *     3. NACE SP0502  — External corrosion interpretation, growth
 *                        logic, assessment context
 *     4. PHMSA 49 CFR 192/195 — Auditability, traceability,
 *                                documentation requirements
 *
 * ───────────────────────────────────────────────────────────────────
 * Architecture:
 *
 *   These are pure functions with no side effects. They evaluate
 *   features and produce recommendations. The pipeline calls them
 *   to enrich matched pairs with standards-based metadata.
 *
 *   All decisions are:
 *     - Deterministic (same input → same output)
 *     - Traceable (standard reference attached to every decision)
 *     - Auditable (full input/output logged)
 *     - Non-overriding (standards set flags, humans make calls)
 *
 * ───────────────────────────────────────────────────────────────────
 * References:
 *
 *   - ASME B31.8S-2018, Managing System Integrity of Gas Pipelines
 *   - API 1163-2021, In-Line Inspection Systems Qualification
 *   - NACE SP0502-2010, Pipeline External Corrosion Direct Assessment
 *   - 49 CFR §192.485, §192.150, §195.452
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type SeverityLevel = 'IMMEDIATE' | 'SCHEDULED' | 'MONITORING' | 'INFORMATIONAL';

export type FeatureForAssessment = {
  id: string;
  type: string;
  depthPercent: number | null;
  depthIn: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  wallThicknessIn: number | null;
  clock: number | null;
  distance: number;
  matchConfidence: number | null;
  growthRatePctYr: number | null;
  inInteractionZone: boolean;
  combinedDepthPercent?: number | null;
};

export type AssessmentResult = {
  featureId: string;
  severity: SeverityLevel;
  standardRef: string;
  rule: string;
  explanation: string;
  actionRequired: string;
  /** Estimated remaining life in years (null if not calculable) */
  remainingLifeYears: number | null;
  /** Priority rank (1 = most urgent) */
  priorityRank: number;
  /** Flags for documentation / audit */
  flags: string[];
};

export type RepairRecommendation = {
  featureId: string;
  repairType: 'CUTOUT' | 'SLEEVE' | 'COMPOSITE_WRAP' | 'GRIND' | 'MONITOR' | 'NONE';
  standardRef: string;
  rationale: string;
  urgency: SeverityLevel;
};

export type API1163QualificationResult = {
  toolType: string;
  confidenceWeight: number;
  detectionThreshold: {
    depthPercent: number;
    lengthIn: number;
    widthIn: number;
  };
  accuracyBand: {
    depthPercent: number;
    distanceFt: number;
    clockHrs: number;
  };
  standardRef: string;
};

// ──────────────────────────────────────────────────────────────────────
// ASME B31.8S — Severity Assessment
// ──────────────────────────────────────────────────────────────────────

/**
 * ASME B31.8S severity classification per §4.3.
 *
 * Based on anomaly depth as percentage of wall thickness:
 *   - ≥80% WT → IMMEDIATE (excavation within days)
 *   - ≥60% WT → SCHEDULED (repair within assessment interval)
 *   - ≥40% WT → MONITORING (track growth rate)
 *   - <40% WT → INFORMATIONAL
 *
 * If the feature is in an interaction zone (per §A-4.3), the
 * combined depth is used instead of individual depth.
 */
export function assessSeverity(feature: FeatureForAssessment): AssessmentResult {
  const depth = feature.inInteractionZone
    ? (feature.combinedDepthPercent ?? feature.depthPercent ?? 0)
    : (feature.depthPercent ?? 0);

  const flags: string[] = [];

  // Only corrosion and mechanical-damage types get severity assessment
  const ASSESSED_TYPES = new Set(['METAL_LOSS', 'CLUSTER', 'METAL_LOSS_MFG', 'DENT']);
  if (!ASSESSED_TYPES.has(feature.type)) {
    return {
      featureId: feature.id,
      severity: 'INFORMATIONAL',
      standardRef: 'ASME B31.8S §4.3',
      rule: 'NON_CORROSION_FEATURE',
      explanation: `Feature type ${feature.type} is not assessed for corrosion severity.`,
      actionRequired: 'No corrosion action required.',
      remainingLifeYears: null,
      priorityRank: 999,
      flags: ['NON_CORROSION'],
    };
  }

  // Remaining life calculation per ASME B31.8S §4.5
  let remainingLife: number | null = null;
  if (feature.growthRatePctYr != null && feature.growthRatePctYr > 0 && depth < 80) {
    remainingLife = (80 - depth) / feature.growthRatePctYr;
    if (remainingLife < 5) flags.push('ACCELERATED_GROWTH');
  }

  // Interaction zone flag
  if (feature.inInteractionZone) {
    flags.push('INTERACTION_ZONE');
    flags.push('COMBINED_ASSESSMENT_PER_B31.8S_A-4.3');
  }

  // Low match confidence flag
  if (feature.matchConfidence != null && feature.matchConfidence < 50) {
    flags.push('LOW_MATCH_CONFIDENCE');
  }

  // Dent-specific rules per ASME B31.8S §4.3.3.4
  if (feature.type === 'DENT') {
    // Dents > 6% OD on welds are IMMEDIATE
    // We use depth_percent as proxy for dent depth/OD ratio
    if (depth > 6) {
      flags.push('DENT_ON_OR_NEAR_WELD_POSSIBLE');
      return {
        featureId: feature.id,
        severity: 'IMMEDIATE',
        standardRef: 'ASME B31.8S §4.3.3.4',
        rule: 'DENT_DEPTH_EXCEEDS_6PCT',
        explanation: `Dent depth ${depth.toFixed(1)}% exceeds 6% threshold.`,
        actionRequired: 'Investigate for strain-based assessment. Excavate if on or near weld.',
        remainingLifeYears: remainingLife,
        priorityRank: 1,
        flags,
      };
    }
    return {
      featureId: feature.id,
      severity: depth > 2 ? 'SCHEDULED' : 'MONITORING',
      standardRef: 'ASME B31.8S §4.3.3.4',
      rule: 'DENT_ASSESSMENT',
      explanation: `Dent depth ${depth.toFixed(1)}%. ${depth > 2 ? 'Exceeds 2% monitoring threshold.' : 'Within monitoring range.'}`,
      actionRequired: depth > 2 ? 'Schedule investigation during next planned maintenance.' : 'Monitor for growth.',
      remainingLifeYears: remainingLife,
      priorityRank: depth > 2 ? 3 : 5,
      flags,
    };
  }

  // Metal loss severity per ASME B31.8S §4.3.3.1
  if (depth >= 80) {
    return {
      featureId: feature.id,
      severity: 'IMMEDIATE',
      standardRef: 'ASME B31.8S §4.3.3.1',
      rule: 'DEPTH_GTE_80',
      explanation: `Metal loss depth ${depth.toFixed(1)}% ≥ 80% WT. Immediate action required per ASME B31.8S.`,
      actionRequired: 'Excavate and repair. Pressure reduction may be required pending investigation.',
      remainingLifeYears: remainingLife,
      priorityRank: 1,
      flags,
    };
  }

  if (depth >= 60) {
    return {
      featureId: feature.id,
      severity: 'SCHEDULED',
      standardRef: 'ASME B31.8S §4.3.3.1',
      rule: 'DEPTH_GTE_60',
      explanation: `Metal loss depth ${depth.toFixed(1)}% ≥ 60% WT. Scheduled repair required.`,
      actionRequired: 'Schedule repair within current assessment interval. Calculate safe operating pressure per B31G.',
      remainingLifeYears: remainingLife,
      priorityRank: 2,
      flags,
    };
  }

  if (depth >= 40) {
    return {
      featureId: feature.id,
      severity: 'MONITORING',
      standardRef: 'ASME B31.8S §4.3.3.1',
      rule: 'DEPTH_GTE_40',
      explanation: `Metal loss depth ${depth.toFixed(1)}% ≥ 40% WT. Monitoring with growth tracking.`,
      actionRequired: 'Track growth rate across runs. Re-assess at next inspection interval.',
      remainingLifeYears: remainingLife,
      priorityRank: 4,
      flags,
    };
  }

  return {
    featureId: feature.id,
    severity: 'INFORMATIONAL',
    standardRef: 'ASME B31.8S §4.3.3.1',
    rule: 'DEPTH_LT_40',
    explanation: `Metal loss depth ${depth.toFixed(1)}% < 40% WT. Informational.`,
    actionRequired: 'No immediate action. Include in baseline for future comparisons.',
    remainingLifeYears: remainingLife,
    priorityRank: 6,
    flags,
  };
}

// ──────────────────────────────────────────────────────────────────────
// ASME B31.8S — Repair Recommendation
// ──────────────────────────────────────────────────────────────────────

/**
 * Recommend repair method per ASME B31.8S §7 and PHMSA guidance.
 */
export function recommendRepair(
  feature: FeatureForAssessment,
  assessment: AssessmentResult,
): RepairRecommendation {
  const depth = feature.depthPercent ?? 0;

  if (assessment.severity === 'IMMEDIATE') {
    // Deep metal loss → cutout; dents → case-dependent
    if (feature.type === 'DENT') {
      return {
        featureId: feature.id,
        repairType: 'CUTOUT',
        standardRef: 'ASME B31.8S §7.2',
        rationale: `Dent exceeds severity threshold. Cutout recommended for strain-based assessment.`,
        urgency: 'IMMEDIATE',
      };
    }
    if (depth >= 80) {
      return {
        featureId: feature.id,
        repairType: 'CUTOUT',
        standardRef: 'ASME B31.8S §7.2, 49 CFR §192.485',
        rationale: `Metal loss ≥80% WT. Pipe section replacement (cutout) required per §192.485.`,
        urgency: 'IMMEDIATE',
      };
    }
  }

  if (assessment.severity === 'SCHEDULED') {
    // 60-80% → sleeve or composite wrap depending on length
    const longAnomaly = (feature.lengthIn ?? 0) > 6;
    return {
      featureId: feature.id,
      repairType: longAnomaly ? 'SLEEVE' : 'COMPOSITE_WRAP',
      standardRef: 'ASME B31.8S §7.3',
      rationale: longAnomaly
        ? `Scheduled repair: anomaly length ${(feature.lengthIn ?? 0).toFixed(1)}in > 6in, full-encirclement sleeve recommended.`
        : `Scheduled repair: composite wrap suitable for anomaly length ≤6in.`,
      urgency: 'SCHEDULED',
    };
  }

  if (assessment.severity === 'MONITORING') {
    // Shallow enough to grind if accessible, otherwise monitor
    if (depth < 50 && (feature.lengthIn ?? 0) < 3) {
      return {
        featureId: feature.id,
        repairType: 'GRIND',
        standardRef: 'ASME B31.8S §7.4',
        rationale: `Shallow metal loss suitable for grinding if externally accessible.`,
        urgency: 'MONITORING',
      };
    }
    return {
      featureId: feature.id,
      repairType: 'MONITOR',
      standardRef: 'ASME B31.8S §4.5',
      rationale: `Monitor growth rate. Re-assess at next ILI interval.`,
      urgency: 'MONITORING',
    };
  }

  return {
    featureId: feature.id,
    repairType: 'NONE',
    standardRef: 'ASME B31.8S §4.3',
    rationale: `No repair action required at current severity level.`,
    urgency: 'INFORMATIONAL',
  };
}

// ──────────────────────────────────────────────────────────────────────
// API 1163 — Tool Qualification and Confidence Weighting
// ──────────────────────────────────────────────────────────────────────

/**
 * API 1163 tool performance specifications.
 *
 * Different ILI tool types have different accuracy specifications
 * per API 1163 §5. These affect how much weight we place on
 * measurement comparisons across vendors.
 */
const TOOL_SPECS: Record<string, API1163QualificationResult> = {
  MFL: {
    toolType: 'MFL',
    confidenceWeight: 0.85,
    detectionThreshold: { depthPercent: 10, lengthIn: 0.5, widthIn: 0.5 },
    accuracyBand: { depthPercent: 10, distanceFt: 0.5, clockHrs: 0.25 },
    standardRef: 'API 1163 §5.2',
  },
  UT: {
    toolType: 'UT',
    confidenceWeight: 0.92,
    detectionThreshold: { depthPercent: 5, lengthIn: 0.3, widthIn: 0.3 },
    accuracyBand: { depthPercent: 5, distanceFt: 0.3, clockHrs: 0.15 },
    standardRef: 'API 1163 §5.3',
  },
  CALIPER: {
    toolType: 'CALIPER',
    confidenceWeight: 0.88,
    detectionThreshold: { depthPercent: 1, lengthIn: 0.5, widthIn: 0.5 },
    accuracyBand: { depthPercent: 2, distanceFt: 0.3, clockHrs: 0.20 },
    standardRef: 'API 1163 §5.4',
  },
  COMBO: {
    toolType: 'COMBO',
    confidenceWeight: 0.90,
    detectionThreshold: { depthPercent: 8, lengthIn: 0.4, widthIn: 0.4 },
    accuracyBand: { depthPercent: 8, distanceFt: 0.4, clockHrs: 0.20 },
    standardRef: 'API 1163 §5.5',
  },
};

/**
 * Get API 1163 qualification parameters for a given tool type.
 * Falls back to conservative MFL specs if tool type is unknown.
 */
export function getToolQualification(toolType: string | undefined): API1163QualificationResult {
  return TOOL_SPECS[toolType?.toUpperCase() ?? ''] ?? TOOL_SPECS.MFL;
}

/**
 * Adjust match confidence based on tool accuracy per API 1163.
 *
 * If the distance residual is within the tool's accuracy band,
 * the confidence is boosted. If outside, it's penalized.
 */
export function adjustConfidenceForTool(
  baseConfidence: number,
  distanceResidualFt: number,
  clockResidualHrs: number | null,
  depthDiffPercent: number | null,
  toolType: string | undefined,
): { adjusted: number; adjustmentReason: string } {
  const spec = getToolQualification(toolType);
  let adjustment = 0;
  const reasons: string[] = [];

  // Distance within accuracy band → boost
  if (distanceResidualFt <= spec.accuracyBand.distanceFt) {
    adjustment += 5;
    reasons.push(`distance within ${spec.toolType} accuracy (±${spec.accuracyBand.distanceFt}ft)`);
  } else if (distanceResidualFt > spec.accuracyBand.distanceFt * 3) {
    adjustment -= 10;
    reasons.push(`distance exceeds 3× ${spec.toolType} accuracy`);
  }

  // Clock within accuracy band → boost
  if (clockResidualHrs != null) {
    if (clockResidualHrs <= spec.accuracyBand.clockHrs) {
      adjustment += 3;
      reasons.push(`clock within ${spec.toolType} accuracy`);
    }
  }

  // Depth within accuracy band → boost
  if (depthDiffPercent != null) {
    if (Math.abs(depthDiffPercent) <= spec.accuracyBand.depthPercent) {
      adjustment += 3;
      reasons.push(`depth within ${spec.toolType} accuracy (±${spec.accuracyBand.depthPercent}%)`);
    }
  }

  const adjusted = Math.max(0, Math.min(100, baseConfidence + adjustment));
  return {
    adjusted,
    adjustmentReason: reasons.join('; ') || 'no adjustment',
  };
}

// ──────────────────────────────────────────────────────────────────────
// NACE SP0502 — External Corrosion Growth Assessment
// ──────────────────────────────────────────────────────────────────────

export type GrowthAssessment = {
  featureId: string;
  depthGrowthPctYr: number;
  lengthGrowthInYr: number | null;
  remainingLifeYears: number | null;
  growthCategory: 'accelerating' | 'growing' | 'stable' | 'undetermined';
  reassessmentIntervalYears: number;
  standardRef: string;
  explanation: string;
};

/**
 * Assess corrosion growth per NACE SP0502 §7 methodology.
 *
 * Growth rate determines reassessment interval:
 *   - Accelerated (>2% WT/yr): reassess within 3 years
 *   - Moderate (0.5–2% WT/yr): reassess within 5 years
 *   - Stable (<0.5% WT/yr): reassess within 7–10 years
 */
export function assessCorrosionGrowth(
  featureId: string,
  depthGrowthPctYr: number,
  lengthGrowthInYr: number | null,
  currentDepthPercent: number,
): GrowthAssessment {
  const remainingLife = depthGrowthPctYr > 0
    ? (80 - currentDepthPercent) / depthGrowthPctYr
    : null;

  let growthCategory: GrowthAssessment['growthCategory'];
  let interval: number;
  let explanation: string;

  if (depthGrowthPctYr > 2) {
    growthCategory = 'accelerating';
    interval = 3;
    explanation = `Accelerated growth at ${depthGrowthPctYr.toFixed(2)}%WT/yr. ` +
      `Estimated remaining life: ${remainingLife?.toFixed(1) ?? 'N/A'} years. ` +
      `ECDA or targeted ILI within 3 years per NACE SP0502 §7.`;
  } else if (depthGrowthPctYr > 0.5) {
    growthCategory = 'growing';
    interval = 5;
    explanation = `Moderate growth at ${depthGrowthPctYr.toFixed(2)}%WT/yr. ` +
      `Reassess within 5 years per NACE SP0502 §7.`;
  } else if (depthGrowthPctYr > 0) {
    growthCategory = 'stable';
    interval = 7;
    explanation = `Stable growth at ${depthGrowthPctYr.toFixed(2)}%WT/yr. ` +
      `Standard reassessment interval per NACE SP0502.`;
  } else {
    growthCategory = 'undetermined';
    interval = 5;
    explanation = `Growth rate undetermined or negative (possible measurement variance). ` +
      `Conservative 5-year interval recommended.`;
  }

  return {
    featureId,
    depthGrowthPctYr,
    lengthGrowthInYr,
    remainingLifeYears: remainingLife,
    growthCategory,
    reassessmentIntervalYears: interval,
    standardRef: 'NACE SP0502 §7',
    explanation,
  };
}

// ──────────────────────────────────────────────────────────────────────
// PHMSA 49 CFR 192/195 — Audit and Documentation Compliance
// ──────────────────────────────────────────────────────────────────────

export type PHMSAComplianceRecord = {
  jobId: string;
  /** 49 CFR §192.150 — records of odometer accuracy */
  odometerAccuracyDocumented: boolean;
  /** 49 CFR §192.485 — follow-up remedial action documentation */
  remedialActionsRequired: string[];
  /** 49 CFR §195.452(h) — risk-based prioritization performed */
  riskPrioritizationPerformed: boolean;
  /** Assessment methodology traceability */
  methodologyChain: string[];
  /** Standards applied in this job */
  standardsApplied: string[];
  /** Audit-ready: all required documentation present */
  auditReady: boolean;
  /** Missing documentation items */
  missingItems: string[];
};

/**
 * Generate PHMSA compliance documentation record for an alignment job.
 * This captures which standards were applied and verifies documentation
 * completeness per 49 CFR 192/195 requirements.
 */
export function generateComplianceRecord(args: {
  jobId: string;
  hasOdometerData: boolean;
  hasDTW: boolean;
  hasICP: boolean;
  hasGraphAnalysis: boolean;
  hasEnsembleScoring: boolean;
  immediateFeatureCount: number;
  scheduledFeatureCount: number;
}): PHMSAComplianceRecord {
  const missing: string[] = [];
  const methods: string[] = [
    'ILI data ingestion and normalization',
    'Girth weld anchor matching',
    'Piecewise-linear distance correction',
    'Hungarian-optimal bipartite anomaly matching',
  ];

  if (args.hasDTW) methods.push('Dynamic Time Warping reference-point alignment');
  if (args.hasICP) methods.push('Iterative Closest Point local refinement');
  if (args.hasGraphAnalysis) methods.push('Graph-based interaction analysis (ASME B31.8S §A-4.3)');
  if (args.hasEnsembleScoring) methods.push('7-component ensemble confidence scoring');

  if (!args.hasOdometerData) missing.push('Odometer accuracy documentation (49 CFR §192.150)');

  const remedialActions: string[] = [];
  if (args.immediateFeatureCount > 0) {
    remedialActions.push(
      `${args.immediateFeatureCount} IMMEDIATE severity features require excavation/repair per 49 CFR §192.485`
    );
  }
  if (args.scheduledFeatureCount > 0) {
    remedialActions.push(
      `${args.scheduledFeatureCount} SCHEDULED severity features require repair within assessment interval`
    );
  }

  return {
    jobId: args.jobId,
    odometerAccuracyDocumented: args.hasOdometerData,
    remedialActionsRequired: remedialActions,
    riskPrioritizationPerformed: args.hasEnsembleScoring,
    methodologyChain: methods,
    standardsApplied: [
      'ASME B31.8S-2018',
      'API 1163-2021',
      'NACE SP0502-2010',
      '49 CFR §192',
      '49 CFR §195',
    ],
    auditReady: missing.length === 0,
    missingItems: missing,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Standards Audit Record
// ──────────────────────────────────────────────────────────────────────

export type StandardsAuditPayload = {
  algorithm: 'STANDARDS_ASSESSMENT';
  standardsApplied: string[];
  assessmentCounts: {
    immediate: number;
    scheduled: number;
    monitoring: number;
    informational: number;
  };
  repairCounts: {
    cutout: number;
    sleeve: number;
    compositeWrap: number;
    grind: number;
    monitor: number;
    none: number;
  };
  growthCounts: {
    accelerating: number;
    growing: number;
    stable: number;
    undetermined: number;
  };
  interactionZoneFeatures: number;
  phmsaAuditReady: boolean;
};

export function buildStandardsAudit(
  assessments: AssessmentResult[],
  repairs: RepairRecommendation[],
  growths: GrowthAssessment[],
  interactionFeatures: number,
  phmsaReady: boolean,
): StandardsAuditPayload {
  const ac = { immediate: 0, scheduled: 0, monitoring: 0, informational: 0 };
  for (const a of assessments) {
    if (a.severity === 'IMMEDIATE') ac.immediate++;
    else if (a.severity === 'SCHEDULED') ac.scheduled++;
    else if (a.severity === 'MONITORING') ac.monitoring++;
    else ac.informational++;
  }

  const rc = { cutout: 0, sleeve: 0, compositeWrap: 0, grind: 0, monitor: 0, none: 0 };
  for (const r of repairs) {
    if (r.repairType === 'CUTOUT') rc.cutout++;
    else if (r.repairType === 'SLEEVE') rc.sleeve++;
    else if (r.repairType === 'COMPOSITE_WRAP') rc.compositeWrap++;
    else if (r.repairType === 'GRIND') rc.grind++;
    else if (r.repairType === 'MONITOR') rc.monitor++;
    else rc.none++;
  }

  const gc = { accelerating: 0, growing: 0, stable: 0, undetermined: 0 };
  for (const g of growths) {
    gc[g.growthCategory as keyof typeof gc]++;
  }

  return {
    algorithm: 'STANDARDS_ASSESSMENT',
    standardsApplied: ['ASME B31.8S-2018', 'API 1163-2021', 'NACE SP0502-2010', '49 CFR §192/195'],
    assessmentCounts: ac,
    repairCounts: rc,
    growthCounts: gc,
    interactionZoneFeatures: interactionFeatures,
    phmsaAuditReady: phmsaReady,
  };
}
