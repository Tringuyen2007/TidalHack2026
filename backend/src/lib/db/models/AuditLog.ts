import { Schema, model, models, type InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema(
  {
    job_id: { type: Schema.Types.ObjectId, ref: 'AlignmentJob', required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entity_id: { type: Schema.Types.ObjectId },
    payload: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;

export const AuditLog = models.AuditLog || model('AuditLog', auditLogSchema);
