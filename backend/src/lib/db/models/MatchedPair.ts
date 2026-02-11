import { Schema, model, models, type InferSchemaType } from 'mongoose';

const matchedPairSchema = new Schema(
  {
    job_id: { type: Schema.Types.ObjectId, ref: 'AlignmentJob', required: true, index: true },
    run_a_feature_id: { type: Schema.Types.ObjectId, ref: 'Feature', required: true },
    run_b_feature_id: { type: Schema.Types.ObjectId, ref: 'Feature', required: true },
    run_a_run_id: { type: Schema.Types.ObjectId, ref: 'Run', required: true },
    run_b_run_id: { type: Schema.Types.ObjectId, ref: 'Run', required: true },
    distance_residual_ft: { type: Number, required: true },
    clock_residual_hrs: { type: Number },
    type_compatibility: { type: Number, required: true },
    dimensional_similarity: { type: Number, required: true },
    confidence_score: { type: Number, required: true },
    confidence_category: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], required: true },
    match_category: { type: String, enum: ['AUTO_MATCHED', 'BEST_MATCH', 'AMBIGUOUS'], required: true },
    depth_growth_pct_yr: { type: Number },
    length_growth_in_yr: { type: Number },
    width_growth_in_yr: { type: Number },
    years_between: { type: Number, required: true },
    competing_candidates: [{ type: Schema.Types.ObjectId, ref: 'Feature' }],
    override_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    override_at: { type: Date, default: null },
    override_reason: { type: String, default: null },
    original_category: { type: String, default: null },
    is_overridden: { type: Boolean, default: false, index: true },
    // ── Standards Attribution ──
    standards_applied: {
      type: {
        asme_b31_8s: {
          applied: { type: Boolean, default: false },
          interaction_zone: { type: Boolean, default: false },
          interaction_severity: { type: String, enum: ['low', 'medium', 'high', null], default: null },
          severity_level: { type: String, enum: ['IMMEDIATE', 'SCHEDULED', 'MONITORING', 'INFORMATIONAL', null], default: null },
          repair_recommendation: { type: String, default: null },
          rationale: { type: String, default: null },
        },
        api_1163: {
          applied: { type: Boolean, default: false },
          tool_weight: { type: Number, default: null },
          adjusted_confidence: { type: Number, default: null },
          adjustment_reason: { type: String, default: null },
        },
        nace_sp0502: {
          applied: { type: Boolean, default: false },
          corrosion_class: { type: String, enum: ['stable', 'growing', 'accelerating', 'undetermined', null], default: null },
          remaining_life_years: { type: Number, default: null },
          reassessment_interval_years: { type: Number, default: null },
        },
        phmsa: {
          audit_logged: { type: Boolean, default: false },
          decision_rationale: { type: String, default: null },
        },
      },
      default: {},
    }
  },
  { timestamps: true }
);

export type MatchedPairDocument = InferSchemaType<typeof matchedPairSchema>;

export const MatchedPair = models.MatchedPair || model('MatchedPair', matchedPairSchema);
