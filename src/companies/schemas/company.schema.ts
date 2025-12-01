import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CompanyDocument = Company & Document;

export enum CompanyStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

@Schema({ timestamps: true })
export class Company {
  @Prop({ required: true })
  name: string;

  @Prop()
  legalName: string;

  @Prop()
  taxId: string;

  @Prop({ type: Map, of: String, default: {} })
  documents: Map<string, string>; // document type -> URL/storage path

  @Prop({
    enum: CompanyStatus,
    default: CompanyStatus.PENDING,
  })
  status: CompanyStatus;

  @Prop()
  approvedAt: Date;

  @Prop()
  approvedBy: string; // Admin user ID who approved

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  @Prop({ default: true })
  isActive: boolean;

  // Onboarding progress tracking
  @Prop({ type: Map, of: Boolean, default: {} })
  onboardingSteps: Map<string, boolean>;
}

export const CompanySchema = SchemaFactory.createForClass(Company);

// Indexes
CompanySchema.index({ status: 1 });
CompanySchema.index({ 'members': 1 });

