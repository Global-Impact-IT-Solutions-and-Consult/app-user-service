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

@Entity('xero_connections')
export class XeroConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  /** Encrypted Xero access token (~30 min) */
  @Column({ type: 'text' })
  accessToken: string;

  /** Encrypted Xero refresh token */
  @Column({ type: 'text' })
  refreshToken: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** Xero organisation tenant ID (xero-tenant-id header) */
  @Column()
  tenantId: string;

  @Column({ nullable: true })
  tenantName: string;

  @Column({ default: 'https://api.xero.com' })
  apiBaseUrl: string;

  /** Cursor for OAuth poll sync (If-Modified-Since) */
  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ default: true })
  pollingEnabled: boolean;

  @Column({ default: 'test' })
  environment: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
