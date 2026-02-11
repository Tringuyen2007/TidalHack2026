import { Schema, model, models, type InferSchemaType } from 'mongoose';

const alignedFeatureSchema = new Schema(
  {
    job_id: { type: Schema.Types.ObjectId, ref: 'AlignmentJob', required: true, index: true },
    feature_id: { type: Schema.Types.ObjectId, ref: 'Feature', required: true },
    run_id: { type: Schema.Types.ObjectId, ref: 'Run', required: true },
    baseline_run_id: { type: Schema.Types.ObjectId, ref: 'Run', required: true },
    original_distance_ft: { type: Number, required: true },
    corrected_distance_ft: { type: Number, required: true },
    applied_offset_ft: { type: Number, required: true },
    segment_index: { type: Number }
  },
  { timestamps: true }
);

export type AlignedFeatureDocument = InferSchemaType<typeof alignedFeatureSchema>;

export const AlignedFeature = models.AlignedFeature || model('AlignedFeature', alignedFeatureSchema);
