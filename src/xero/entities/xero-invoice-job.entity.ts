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

export enum XeroInvoiceJobStatus {
  IMPORTED = 'imported',
  SUBMITTED = 'submitted',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  WRITEBACK_PENDING = 'writeback_pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('xero_invoice_jobs')
export class XeroInvoiceJob {
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
  xeroInvoiceId: string;

  @Column({ nullable: true })
  xeroInvoiceNumber: string;

  @Column({ nullable: true })
  receiptId: string;

  @Column({ default: 'test' })
  environment: string;

  @Index()
  @Column({
    type: 'enum',
    enum: XeroInvoiceJobStatus,
    default: XeroInvoiceJobStatus.IMPORTED,
  })
  status: XeroInvoiceJobStatus;

  @Column({ type: 'jsonb', nullable: true })
  sourcePayload: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  processedPayload: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
