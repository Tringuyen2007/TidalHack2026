import { Schema, model, models, type InferSchemaType } from 'mongoose';

const runSchema = new Schema(
  {
    dataset_id: { type: Schema.Types.ObjectId, ref: 'Dataset', required: true, index: true },
    org_id: { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
    year: { type: Number, required: true, index: true },
    label: { type: String, required: true },
    vendor: { type: String },
    tool_type: { type: String },
    inspection_date: { type: Date, default: null },
    inspection_date_raw: { type: String, default: '' },
    inspection_date_source: {
      type: String,
      enum: ['excel_serial', 'iso_string', 'us_format', 'textual', 'js_date', 'gemini', 'year_only', null],
      default: null
    },
    inspection_date_confidence: { type: Number, default: 0, min: 0, max: 1 },
    inspection_date_warning: { type: String },
    start_odometer_ft: { type: Number },
    end_odometer_ft: { type: Number },
    total_rows: { type: Number, default: 0 },
    total_features: { type: Number, default: 0 },
    // ── API 1163 Tool Qualification ──
    tool_qualification: {
      type: {
        qualification_level: { type: String, enum: ['HIGH', 'STANDARD', 'BASIC', 'UNKNOWN'], default: 'UNKNOWN' },
        tool_generation: { type: String, default: null },
        confidence_weight: { type: Number, default: 0.85 },
        accuracy_depth_pct: { type: Number, default: 10 },
        accuracy_distance_ft: { type: Number, default: 0.5 },
        accuracy_clock_hrs: { type: Number, default: 0.25 },
      },
      default: {},
    }
  },
  { timestamps: true }
);

export type RunDocument = InferSchemaType<typeof runSchema>;

export const Run = models.Run || model('Run', runSchema);
