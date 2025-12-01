import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggingController } from './logging.controller';
import { LoggingService } from './logging.service';
import { SearchService } from './search.service';
import { Log, LogSchema } from './schemas/log.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Log.name, schema: LogSchema }])],
  controllers: [LoggingController],
  providers: [LoggingService, SearchService],
  exports: [SearchService, LoggingService],
})
export class LoggingModule {}
