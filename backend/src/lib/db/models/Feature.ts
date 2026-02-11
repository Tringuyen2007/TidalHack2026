import { Schema, model, models, type InferSchemaType } from 'mongoose';

export const CANONICAL_EVENT_TYPES = [
  'GIRTH_WELD',
  'METAL_LOSS',
  'CLUSTER',
  'METAL_LOSS_MFG',
  'BEND',
  'FIELD_BEND',
  'VALVE',
  'TEE',
  'TAP',
  'AGM',
  'DENT',
  'SEAM_WELD_MFG',
  'SLEEVE_START',
  'SLEEVE_END',
  'ATTACHMENT',
  'REPAIR_MARKER_START',
  'REPAIR_MARKER_END',
  'COMPOSITE_WRAP_START',
  'COMPOSITE_WRAP_END',
  'LAUNCHER',
  'RECEIVER',
  'FLANGE',
  'SUPPORT',
  'MAGNET',
  'CP_POINT',
  'RECOAT_START',
  'RECOAT_END',
  'OTHER'
] as const;

const featureSchema = new Schema(
  {
    run_id: { type: Schema.Types.ObjectId, ref: 'Run', required: true, index: true },
    org_id: { type: Schema.Types.ObjectId, required: true, index: true },
    row_index: { type: Number, required: true },
    joint_number: { type: Number, index: true },
    joint_length_ft: { type: Number },
    wall_thickness_in: { type: Number },
    log_distance_ft: { type: Number, index: true },
    corrected_distance_ft: { type: Number, index: true },
    dist_to_upstream_weld_ft: { type: Number },
    event_type_raw: { type: String },
    event_type_canonical: { type: String, enum: CANONICAL_EVENT_TYPES, index: true, default: 'OTHER' },
    depth_percent: { type: Number },
    depth_in: { type: Number },
    length_in: { type: Number },
    width_in: { type: Number },
    clock_position_raw: { type: String },
    clock_decimal: { type: Number },
    is_reference_point: { type: Boolean, default: false, index: true },
    elevation_ft: { type: Number },
    comments: { type: String },
    original_metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

export type FeatureDocument = InferSchemaType<typeof featureSchema>;

export const Feature = models.Feature || model('Feature', featureSchema);
