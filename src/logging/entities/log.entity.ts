import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('logs')
@Index(['companyId', 'environment', 'timestamp'])
@Index(['receiptId', 'timestamp'])
@Index(['eventType', 'timestamp'])
@Index(['companyId', 'environment', 'eventType', 'timestamp'])
export class Log {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  companyId: string;

  @Column()
  @Index()
  environment: string; // 'test' or 'live'

  @Column({ nullable: true })
  @Index()
  receiptId: string;

  @Column()
  @Index()
  eventType: string;

  @Column({ nullable: true })
  @Index()
  processingStage: string;

  @Column({ type: 'timestamp' })
  @Index()
  timestamp: Date;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any>;

  @Column({ nullable: true })
  message: string;

  @Column({ nullable: true })
  level: string;

  @Column('jsonb', { nullable: true })
  data: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
