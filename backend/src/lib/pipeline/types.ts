export type StageName =
  | 'ingest'
  | 'normalize'
  | 'anchor'
  | 'correct'
  | 'match'
  | 'score'
  | 'export';

export type ParsedRun = {
  year: number;
  label: string;
  headers: string[];
  rows: Record<string, unknown>[];
  summary?: {
    vendor?: string;
    tool_type?: string;
    /** Raw date value from the spreadsheet — parsed later by date-parser utility */
    inspection_date_raw?: unknown;
    start_odometer_ft?: number;
    end_odometer_ft?: number;
  };
};

export type AnchorPair = {
  olderWeldFeatureId: string;
  newerWeldFeatureId: string;
  olderDistance: number;
  newerDistance: number;
  olderJoint?: number;
  newerJoint?: number;
  segmentIndex: number;
  driftFt: number;
  isResetPoint?: boolean;
};

export type CorrectionSegment = {
  segmentIndex: number;
  x0: number;
  x1: number;
  offset0: number;
  offset1: number;
  slope: number;
};

export type MatchCandidate = {
  olderFeatureId: string;
  newerFeatureId: string;
  score: number;
  distanceResidualFt: number;
  clockResidualHrs: number | null;
  typeCompatibility: number;
  dimensionalSimilarity: number;
};

export type PipelineContext = {
  jobId: string;
  datasetId: string;
  orgId: string;
  runIds?: string[];
  baselineYear?: number;
};
