import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [HttpModule, LoggingModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}

