import { Schema, model, models, type InferSchemaType } from 'mongoose';

const exceptionSchema = new Schema(
  {
    job_id: { type: Schema.Types.ObjectId, ref: 'AlignmentJob', required: true, index: true },
    run_id: { type: Schema.Types.ObjectId, ref: 'Run' },
    feature_id: { type: Schema.Types.ObjectId, ref: 'Feature' },
    category: {
      type: String,
      enum: [
        'UNMATCHED', 'LOW_CONFIDENCE', 'CLOCK_MISSING', 'SEGMENT_DRIFT',
        'TYPE_INCOMPATIBLE', 'CUTOUT_RESET',
        // Run-3 refinement categories (post-matching, pre-visualization)
        'NEIGHBORHOOD_EXCESS',   // Likely split/duplicate of nearby matched anomaly
        'RUN3_UNSUPPORTED',      // Baseline anomaly with no match and insufficient data
        'MULTI_RUN_MATCH',       // Audit: feature matched in multiple older runs
        // Standards-based categories
        'INTERACTION_ZONE',      // ASME B31.8S interaction zone detected
        'IMMEDIATE_SEVERITY',    // ASME B31.8S immediate action required
        'ACCELERATED_GROWTH'     // NACE SP0502 accelerated corrosion growth
      ],
      required: true
    },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    details: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type ExceptionDocument = InferSchemaType<typeof exceptionSchema>;

export const Exception = models.Exception || model('Exception', exceptionSchema);
