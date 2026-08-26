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

export enum InvoiceSource {
  XERO = 'xero',
  QUICKBOOKS = 'quickbooks',
  ZOHO_BOOKS = 'zoho_books',
  MANUAL = 'manual',
}

export enum NrsInvoiceStatus {
  NOT_SUBMITTED = 'not_submitted',
  PREVIEWED = 'previewed',
  SUBMITTED = 'submitted',
  FAILED = 'failed',
}

export type InvoiceLine = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  taxRate?: number;
  taxAmount?: number;
  hsnCode?: string;
  isicCode?: string;
  unit?: string;
};

@Entity('invoices')
@Index(['companyId', 'source', 'externalId'], { unique: true })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Index()
  @Column({ default: 'test' })
  environment: string;

  @Index()
  @Column({ type: 'enum', enum: InvoiceSource })
  source: InvoiceSource;

  @Column()
  externalId: string;

  @Column({ type: 'varchar', nullable: true })
  invoiceNumber: string | null;

  @Column({ type: 'date', nullable: true })
  issueDate: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  currency: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  subtotal: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  taxTotal: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  total: string | null;

  @Column({ type: 'varchar', nullable: true })
  status: string | null;

  @Column({ type: 'varchar', nullable: true })
  sellerName: string | null;

  @Column({ type: 'varchar', nullable: true })
  sellerTin: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerName: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerTin: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerEmail: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerPhone: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  lines: InvoiceLine[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sourcePayload: Record<string, unknown> | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  irn: string | null;

  @Column({ type: 'varchar', nullable: true })
  csid: string | null;

  @Column({ type: 'text', nullable: true })
  qrCodeData: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: NrsInvoiceStatus,
    default: NrsInvoiceStatus.NOT_SUBMITTED,
  })
  nrsStatus: NrsInvoiceStatus;

  @Column({ type: 'jsonb', nullable: true })
  nrsPayload: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  nrsResponse: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  nrsError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
