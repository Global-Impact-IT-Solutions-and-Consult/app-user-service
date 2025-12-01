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
import { ApiKey } from './api-key.entity';
import { Webhook } from './webhook.entity';

export enum CompanyStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

@Entity('companies')
@Index(['status'])
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

  @OneToMany(() => ApiKey, (apiKey) => apiKey.company)
  apiKeys: ApiKey[];

  @OneToMany(() => Webhook, (webhook) => webhook.company)
  webhooks: Webhook[];

  @Column({ default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  onboardingSteps: Record<string, boolean>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
