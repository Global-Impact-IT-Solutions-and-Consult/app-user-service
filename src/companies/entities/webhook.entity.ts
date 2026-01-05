import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Settings } from './settings.entity';
import { WebhookEvent } from './webhook-event.entity';

@Entity('webhooks')
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  settingsId: string;

  @ManyToOne(() => Settings, (settings) => settings.webhooks)
  @JoinColumn({ name: 'settingsId' })
  settings: Settings;

  @Index()
  @Column()
  companyId: string;

  @Column()
  url: string;

  @Column()
  signingSecretHash: string;

  @Column({ type: 'text', array: true, default: '{}' })
  subscribedEvents: string[];

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

  @OneToMany(() => WebhookEvent, (event) => event.webhook)
  events: WebhookEvent[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
