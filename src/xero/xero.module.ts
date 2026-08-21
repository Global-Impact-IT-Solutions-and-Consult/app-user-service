import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XeroController } from './xero.controller';
import { XeroService } from './xero.service';
import { XeroConnection } from './entities/xero-connection.entity';
import { XeroInvoiceJob } from './entities/xero-invoice-job.entity';
import { Company } from '../companies/entities/company.entity';
import { ReceiptsModule } from '../receipts/receipts.module';
import { LoggingModule } from '../logging/logging.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([XeroConnection, XeroInvoiceJob, Company]),
    ReceiptsModule,
    LoggingModule,
    InvoicesModule,
  ],
  controllers: [XeroController],
  providers: [XeroService],
  exports: [XeroService],
})
export class XeroModule {}
