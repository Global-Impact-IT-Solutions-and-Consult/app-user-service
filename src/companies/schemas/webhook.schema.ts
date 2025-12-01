import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WebhookDocument = Webhook & Document;

export enum WebhookEnvironment {
  TEST = 'test',
  LIVE = 'live',
}

@Schema({ timestamps: true })
export class Webhook {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true })
  companyId: Types.ObjectId;

  @Prop({ type: String, enum: WebhookEnvironment, required: true })
  environment: WebhookEnvironment;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  signingSecretHash: string; // Encrypted signing secret

  @Prop({ type: [String], default: [] })
  events: string[]; // Event types to subscribe to

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastTriggeredAt: Date;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop({ type: Map, of: String, default: {} })
  metadata: Map<string, string>; // Additional metadata
}

export const WebhookSchema = SchemaFactory.createForClass(Webhook);

// Indexes
WebhookSchema.index({ companyId: 1, environment: 1 });
WebhookSchema.index({ companyId: 1, isActive: 1 });
WebhookSchema.index({ url: 1 });

