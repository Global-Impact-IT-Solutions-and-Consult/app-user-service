import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';

export enum ZohoWebhookStatus {
  PENDING = 'pending',
  CONNECTED = 'connected',
  DISABLED = 'disabled',
}

@Entity('zoho_webhook_endpoints')
export class ZohoWebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  /** Unguessable URL token — identifies the company webhook */
  @Index({ unique: true })
  @Column()
  webhookToken: string;

  /** Encrypted shared secret for Zoho header / HMAC verification */
  @Column({ type: 'text' })
  signingSecretEncrypted: string;

  @Index()
  @Column({
    type: 'varchar',
    default: ZohoWebhookStatus.PENDING,
  })
  status: ZohoWebhookStatus;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastReceivedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastEventType: string | null;

  @Column({ default: 0 })
  receiveCount: number;

  /** Truncated snapshot of the last payload (for debugging) */
  @Column({ type: 'jsonb', nullable: true })
  lastPayload: Record<string, unknown> | null;

  @Column({ default: 'test' })
  environment: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
