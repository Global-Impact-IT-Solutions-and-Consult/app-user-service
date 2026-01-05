import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Company } from './entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { CompanySettingsModule } from '../company-settings/company-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, User]),
    UsersModule,
    CompanySettingsModule,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
