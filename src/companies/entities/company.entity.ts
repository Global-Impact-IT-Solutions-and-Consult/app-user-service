import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinTable,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CompanySettings } from './company-settings.entity';

export enum CompanyStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  legalName: string;

  @Column({ nullable: true })
  taxId: string;

  @Column('jsonb', { nullable: true })
  documents: Record<string, string>;

  @Index()
  @Column({
    type: 'enum',
    enum: CompanyStatus,
    default: CompanyStatus.PENDING,
  })
  status: CompanyStatus;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date;

  @Column({ nullable: true })
  approvedBy: string;

  @ManyToMany(() => User, (user) => user.companies)
  @JoinTable({
    name: 'user_companies',
    joinColumn: { name: 'companyId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'userId', referencedColumnName: 'id' },
  })
  members: User[];

  @OneToMany(
    () => CompanySettings,
    (companySettings) => companySettings.company,
  )
  companySettings: CompanySettings[];

  @Column({ default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  onboardingSteps: Record<string, boolean>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
