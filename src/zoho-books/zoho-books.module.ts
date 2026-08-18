import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZohoBooksController } from './zoho-books.controller';
import { ZohoBooksWebhookController } from './zoho-books-webhook.controller';
import { ZohoBooksService } from './zoho-books.service';
import { ZohoConnection } from './entities/zoho-connection.entity';
import { ZohoInvoiceJob } from './entities/zoho-invoice-job.entity';
import { ZohoWebhookEndpoint } from './entities/zoho-webhook-endpoint.entity';
import { Company } from '../companies/entities/company.entity';
import { ReceiptsModule } from '../receipts/receipts.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ZohoConnection,
      ZohoInvoiceJob,
      ZohoWebhookEndpoint,
      Company,
    ]),
    ReceiptsModule,
    LoggingModule,
  ],
  controllers: [ZohoBooksController, ZohoBooksWebhookController],
  providers: [ZohoBooksService],
  exports: [ZohoBooksService],
})
export class ZohoBooksModule {}
