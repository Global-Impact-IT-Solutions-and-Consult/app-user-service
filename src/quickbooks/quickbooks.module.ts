import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuickBooksController } from './quickbooks.controller';
import { QuickBooksService } from './quickbooks.service';
import { QuickBooksConnection } from './entities/quickbooks-connection.entity';
import { QuickBooksInvoiceJob } from './entities/quickbooks-invoice-job.entity';
import { Company } from '../companies/entities/company.entity';
import { ReceiptsModule } from '../receipts/receipts.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuickBooksConnection,
      QuickBooksInvoiceJob,
      Company,
    ]),
    ReceiptsModule,
    LoggingModule,
  ],
  controllers: [QuickBooksController],
  providers: [QuickBooksService],
  exports: [QuickBooksService],
})
export class QuickBooksModule {}
