import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ApiKeyDocument = ApiKey & Document;

export enum ApiKeyEnvironment {
  TEST = 'test',
  LIVE = 'live',
}

@Schema({ timestamps: true })
export class ApiKey {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true })
  companyId: Types.ObjectId;

  @Prop({ type: String, enum: ApiKeyEnvironment, required: true })
  environment: ApiKeyEnvironment;

  @Prop({ required: true, unique: true })
  publicKey: string; // Exposed to user (e.g., pk_test_xxx)

  @Prop({ required: true })
  secretKeyHash: string; // Encrypted secret key

  @Prop()
  lastUsedAt: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt: Date;

  @Prop()
  revokedAt: Date;

  @Prop()
  revokedBy: string; // User ID who revoked

  @Prop({ default: 0 })
  usageCount: number;
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

// Indexes for faster queries
ApiKeySchema.index({ companyId: 1, environment: 1 });
ApiKeySchema.index({ publicKey: 1 });
ApiKeySchema.index({ companyId: 1, isActive: 1 });

