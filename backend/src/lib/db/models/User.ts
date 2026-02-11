import { Schema, model, models, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    password_hash: { type: String, required: true },
    org_id: { type: Schema.Types.ObjectId, ref: 'Org', index: true }
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof userSchema>;

export const User = models.User || model('User', userSchema);
