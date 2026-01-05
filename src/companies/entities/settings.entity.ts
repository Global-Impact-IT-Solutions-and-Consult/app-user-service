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
import { CompanySettings } from './company-settings.entity';
import { Webhook } from './webhook.entity';

export enum SettingsType {
  TEST = 'test',
  LIVE = 'live',
}

@Entity('settings')
@Index(['companySettingsId', 'type'], { unique: true })
export class Settings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  companySettingsId: string;

  @ManyToOne(() => CompanySettings, (companySettings) => companySettings.settings)
  @JoinColumn({ name: 'companySettingsId' })
  companySettings: CompanySettings;

  @Index()
  @Column({
    type: 'enum',
    enum: SettingsType,
  })
  type: SettingsType;

  // API Keys (embedded in Settings)
  @Index()
  @Column({ type: 'varchar', unique: true, nullable: true })
  publicKey: string | null;

  @Column({ type: 'varchar', nullable: true })
  secretKeyHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  revokedBy: string | null;

  @Column({ default: 0 })
  usageCount: number;

  // Webhooks relationship
  @OneToMany(() => Webhook, (webhook) => webhook.settings)
  webhooks: Webhook[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

