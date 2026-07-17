import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZohoBooksController } from './zoho-books.controller';
import { ZohoBooksService } from './zoho-books.service';
import { ZohoConnection } from './entities/zoho-connection.entity';
import { ZohoInvoiceJob } from './entities/zoho-invoice-job.entity';
import { ZohoWebhookEndpoint } from './entities/zoho-webhook-endpoint.entity';
import { Company } from '../companies/entities/company.entity';
import { ReceiptsModule } from '../receipts/receipts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ZohoConnection,
      ZohoInvoiceJob,
      ZohoWebhookEndpoint,
      Company,
    ]),
    ReceiptsModule,
  ],
  controllers: [ZohoBooksController],
  providers: [ZohoBooksService],
  exports: [ZohoBooksService],
})
export class ZohoBooksModule {}
