import { Schema, model, models, type InferSchemaType } from 'mongoose';

const orgSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }
  },
  { timestamps: true }
);

export type OrgDocument = InferSchemaType<typeof orgSchema>;

export const Org = models.Org || model('Org', orgSchema);
