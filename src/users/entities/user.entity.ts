import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';

export enum Environment {
  TEST = 'test',
  LIVE = 'live',
}

@Entity('users')
@Index(['email'])
@Index(['currentCompanyId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  passwordHash: string | null;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  mfaSecret: string | null; // For backward compatibility

  @Column({ type: 'varchar', nullable: true, length: 10 })
  otpCode: string | null; // Email OTP code

  @Column({ type: 'timestamp', nullable: true })
  otpExpiresAt: Date | null;

  @Column({ default: false })
  mfaEnabled: boolean;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  googleId: string | null; // Google OAuth ID

  @Column({ default: false })
  isGoogleAuth: boolean;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({
    type: 'enum',
    enum: Environment,
    default: Environment.TEST,
  })
  currentEnvironment: Environment;

  @Column({ type: 'uuid', nullable: true })
  currentCompanyId: string | null;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: 'currentCompanyId' })
  currentCompany: Company;

  @Column({ type: 'text', array: true, default: '{}' })
  roles: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  permissions: string[];

  @ManyToMany(() => Company, (company) => company.members)
  @JoinTable({
    name: 'user_companies',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'companyId', referencedColumnName: 'id' },
  })
  companies: Company[];

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @Column({ default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
