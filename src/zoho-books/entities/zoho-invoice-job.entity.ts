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

export enum ZohoInvoiceJobStatus {
  IMPORTED = 'imported',
  SUBMITTED = 'submitted',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  WRITEBACK_PENDING = 'writeback_pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('zoho_invoice_jobs')
export class ZohoInvoiceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column()
  zohoInvoiceId: string;

  @Column({ nullable: true })
  zohoInvoiceNumber: string;

  @Column({ nullable: true })
  receiptId: string;

  @Column({ default: 'test' })
  environment: string;

  @Index()
  @Column({
    type: 'enum',
    enum: ZohoInvoiceJobStatus,
    default: ZohoInvoiceJobStatus.IMPORTED,
  })
  status: ZohoInvoiceJobStatus;

  /** Snapshot of the Zoho invoice at import time */
  @Column({ type: 'jsonb', nullable: true })
  sourcePayload: Record<string, unknown>;

  /** Latest processing result from the receipt service */
  @Column({ type: 'jsonb', nullable: true })
  processedPayload: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  writeBackAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
