import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Company } from './company.entity';

export enum WebhookEnvironment {
  TEST = 'test',
  LIVE = 'live',
}

@Entity('webhooks')
@Index(['companyId', 'environment'])
@Index(['companyId', 'isActive'])
@Index(['url'])
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @ManyToOne(() => Company, (company) => company.webhooks)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({
    type: 'enum',
    enum: WebhookEnvironment,
  })
  environment: WebhookEnvironment;

  @Column()
  url: string;

  @Column()
  signingSecretHash: string;

  @Column({ type: 'text', array: true, default: '{}' })
  events: string[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastTriggeredAt: Date;

  @Column({ default: 0 })
  successCount: number;

  @Column({ default: 0 })
  failureCount: number;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, string>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
