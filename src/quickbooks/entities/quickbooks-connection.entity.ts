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

@Entity('quickbooks_connections')
export class QuickBooksConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  /** Encrypted QBO access token (~60 min) */
  @Column({ type: 'text' })
  accessToken: string;

  /** Encrypted QBO refresh token (rotates — always persist latest) */
  @Column({ type: 'text' })
  refreshToken: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** QuickBooks Online company / realm ID */
  @Column()
  realmId: string;

  /** Production or sandbox API host */
  @Column({ default: 'https://quickbooks.api.intuit.com' })
  apiBaseUrl: string;

  /** Cursor for OAuth poll sync */
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
