import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Company } from './company.entity';

export enum ApiKeyEnvironment {
  TEST = 'test',
  LIVE = 'live',
}

@Entity('api_keys')
@Index(['companyId', 'environment'])
@Index(['publicKey'])
@Index(['companyId', 'isActive'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @ManyToOne(() => Company, (company) => company.apiKeys)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({
    type: 'enum',
    enum: ApiKeyEnvironment,
  })
  environment: ApiKeyEnvironment;

  @Column({ unique: true })
  publicKey: string;

  @Column()
  secretKeyHash: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date;

  @Column({ nullable: true })
  revokedBy: string;

  @Column({ default: 0 })
  usageCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
