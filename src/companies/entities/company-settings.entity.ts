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
import { Company } from './company.entity';
import { Settings } from './settings.entity';

@Entity('company_settings')
@Index(['companyId'], { unique: true })
export class CompanySettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  companyId: string;

  @ManyToOne(() => Company, (company) => company.companySettings)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ default: false })
  mfaRequired: boolean;

  @OneToMany(() => Settings, (settings) => settings.companySettings)
  settings: Settings[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

