import { Schema, model, models, type InferSchemaType } from 'mongoose';

const datasetSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
    uploaded_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    source_filename: { type: String, required: true },
    run_ids: [{ type: Schema.Types.ObjectId, ref: 'Run' }],
    total_features: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type DatasetDocument = InferSchemaType<typeof datasetSchema>;

export const Dataset = models.Dataset || model('Dataset', datasetSchema);
