import { Schema, model, models, type InferSchemaType } from 'mongoose';

const alignmentJobSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, required: true, index: true },
    dataset_id: { type: Schema.Types.ObjectId, ref: 'Dataset', required: true, index: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'],
      default: 'QUEUED',
      index: true
    },
    current_stage: { type: Number, default: 0 },
    progress_pct: { type: Number, default: 0 },
    stage_status: {
      type: [
        {
          stage: Number,
          name: String,
          status: { type: String, enum: ['PENDING', 'RUNNING', 'DONE', 'FAILED'], default: 'PENDING' },
          message: String,
          started_at: Date,
          finished_at: Date
        }
      ],
      default: []
    },
    run_pair_ids: {
      type: [
        {
          older_run_id: Schema.Types.ObjectId,
          newer_run_id: Schema.Types.ObjectId
        }
      ],
      default: []
    },
    enable_ml: { type: Boolean, default: false },
    result_summary: { type: Schema.Types.Mixed },
    error: { type: String }
  },
  { timestamps: true }
);

export type AlignmentJobDocument = InferSchemaType<typeof alignmentJobSchema>;

export const AlignmentJob = models.AlignmentJob || model('AlignmentJob', alignmentJobSchema);
