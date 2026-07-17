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

@Entity('zoho_connections')
export class ZohoConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  /** Encrypted Zoho access token */
  @Column({ type: 'text' })
  accessToken: string;

  /** Encrypted Zoho refresh token */
  @Column({ type: 'text' })
  refreshToken: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** Zoho Books organization ID */
  @Column({ nullable: true })
  organizationId: string;

  /** API domain from OAuth (e.g. https://www.zohoapis.com) */
  @Column({ default: 'https://www.zohoapis.com' })
  apiDomain: string;

  /** Accounts domain for token refresh (e.g. https://accounts.zoho.com) */
  @Column({ default: 'https://accounts.zoho.com' })
  accountsDomain: string;

  /** Cached Zoho contact ID for this company */
  @Column({ nullable: true })
  zohoContactId: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
