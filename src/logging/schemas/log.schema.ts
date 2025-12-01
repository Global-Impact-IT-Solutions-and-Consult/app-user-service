import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LogDocument = Log & Document;

@Schema({ timestamps: true })
export class Log {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ required: true, index: true })
  environment: string; // 'test' or 'live'

  @Prop({ type: Types.ObjectId, index: true })
  receiptId?: Types.ObjectId;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ index: true })
  processingStage?: string;

  @Prop({ required: true, index: true })
  timestamp: Date;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop()
  message?: string;

  @Prop()
  level?: string; // 'info', 'warning', 'error', etc.

  @Prop({ type: Object, default: {} })
  data: Record<string, any>;
}

export const LogSchema = SchemaFactory.createForClass(Log);

// Compound indexes for common queries
LogSchema.index({ companyId: 1, environment: 1, timestamp: -1 });
LogSchema.index({ receiptId: 1, timestamp: -1 });
LogSchema.index({ eventType: 1, timestamp: -1 });
LogSchema.index({ companyId: 1, environment: 1, eventType: 1, timestamp: -1 });
