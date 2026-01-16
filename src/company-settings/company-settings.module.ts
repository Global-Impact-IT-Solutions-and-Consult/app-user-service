import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanySettingsController } from './company-settings.controller';
import { CompanySettingsService } from './company-settings.service';
import { CompanySettings } from '../companies/entities/company-settings.entity';
import { Settings } from '../companies/entities/settings.entity';
import { Webhook } from '../companies/entities/webhook.entity';
import { WebhookEvent } from '../companies/entities/webhook-event.entity';
import { Company } from '../companies/entities/company.entity';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CompanySettings,
      Settings,
      Webhook,
      WebhookEvent,
      Company,
    ]),
    LoggingModule,
  ],
  controllers: [CompanySettingsController],
  providers: [CompanySettingsService],
  exports: [CompanySettingsService],
})
export class CompanySettingsModule {}

