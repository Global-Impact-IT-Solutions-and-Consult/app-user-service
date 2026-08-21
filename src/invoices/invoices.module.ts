import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { Invoice } from './entities/invoice.entity';
import { Company } from '../companies/entities/company.entity';
import { LoggingModule } from '../logging/logging.module';
import { NrsModule } from '../nrs/nrs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Company]),
    LoggingModule,
    NrsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
