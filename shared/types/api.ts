/* ------------------------------------------------------------------ */
/*  Shared API type definitions (DTOs)                                */
/*  These mirror backend Mongoose schemas — do NOT add runtime code.  */
/* ------------------------------------------------------------------ */

/* ── Auth ── */

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  orgName: string;
}

export interface RegisterResponse {
  id: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  orgId: string;
}

/* ── Dataset ── */

export interface Dataset {
  _id: string;
  name: string;
  org_id: string;
  uploaded_by: string;
  file_type: string;
  file_size_bytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  _id: string;
  dataset_id: string;
  label: string;
  year: number;
  vendor?: string;
  tool_type?: string;
  is_baseline: boolean;
  run_index: number;
  feature_count: number;
  createdAt: string;
}

/* ── Alignment Job ── */

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type StageStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface PipelineStage {
  name: string;
  status: StageStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface AlignmentJob {
  _id: string;
  dataset_id: string;
  org_id: string;
  started_by: string;
  status: JobStatus;
  enable_ml: boolean;
  stages: PipelineStage[];
  result_summary?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/* ── Matched Pair ── */

export interface StandardsApplied {
  asme_b318s?: {
    severity: "IMMEDIATE" | "SCHEDULED" | "MONITORING" | "INFORMATIONAL";
    repair_recommendation?: string;
    interaction_zone?: boolean;
  };
  api_1163?: {
    tool_qualification_weight: number;
    confidence_adjustment: number;
  };
  nace_sp0502?: {
    corrosion_class: "accelerating" | "growing" | "stable" | "undetermined" | null;
    remaining_life_years?: number;
    reassessment_interval_years?: number;
  };
  phmsa_compliance?: {
    regulation: string;
    decision_rationale: string;
  };
}

export interface MatchedPair {
  _id: string;
  job_id: string;
  run_a_feature_id: string;
  run_b_feature_id: string;
  distance_a: number;
  distance_b: number;
  residual_ft: number;
  event_type: string;
  confidence_score: number;
  confidence_category: "HIGH" | "MEDIUM" | "LOW";
  growth_rate_pct_yr?: number;
  standards_applied?: StandardsApplied;
  createdAt: string;
}

/* ── Exception ── */

export interface Exception {
  _id: string;
  job_id: string;
  feature_id: string;
  run_id: string;
  type: string;
  reason: string;
  severity: string;
  createdAt: string;
}

/* ── Audit Log ── */

export interface AuditLog {
  _id: string;
  job_id: string;
  action: string;
  stage?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

/* ── Result Summary (from GET /api/alignment/results/:id) ── */

export interface ResultSummary {
  totalMatches: number;
  totalExceptions: number;
  confidence: {
    high: number;
    medium: number;
    low: number;
  };
  standards: {
    severity: {
      immediate: number;
      scheduled: number;
      monitoring: number;
    };
    acceleratingGrowth: number;
    interactionZones: number;
  };
  mlSidecar?: {
    active: boolean;
    pairsScored: number;
    growthsAssessed: number;
    clustersFound: number;
    errors: number;
  };
}
