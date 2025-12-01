import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum Environment {
  TEST = 'test',
  LIVE = 'live',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop()
  mfaSecret: string;

  @Prop({ default: false })
  mfaEnabled: boolean;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ enum: Environment, default: Environment.TEST })
  currentEnvironment: Environment;

  @Prop({ type: Types.ObjectId, ref: 'Company' })
  currentCompanyId: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  roles: string[];

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Company' }], default: [] })
  companies: Types.ObjectId[];

  @Prop()
  lastLoginAt: Date;

  @Prop({ default: 0 })
  failedLoginAttempts: number;

  @Prop()
  lockedUntil: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes for performance
UserSchema.index({ email: 1 });
UserSchema.index({ currentCompanyId: 1 });
UserSchema.index({ 'companies': 1 });

