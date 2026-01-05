import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Webhook } from './webhook.entity';

export enum WebhookEventStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  webhookId: string;

  @ManyToOne(() => Webhook, (webhook) => webhook.events)
  @JoinColumn({ name: 'webhookId' })
  webhook: Webhook;

  @Index()
  @Column()
  companyId: string;

  @Index()
  @Column()
  eventType: string;

  @Column('jsonb')
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: WebhookEventStatus,
    default: WebhookEventStatus.PENDING,
  })
  status: WebhookEventStatus;

  @Column({ nullable: true })
  responseStatus: number;

  @Column('text', { nullable: true })
  responseBody: string;

  @Column('text', { nullable: true })
  errorMessage: string;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

