import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingController } from './logging.controller';
import { LoggingService } from './logging.service';
import { SearchService } from './search.service';
import { Log } from './entities/log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Log])],
  controllers: [LoggingController],
  providers: [LoggingService, SearchService],
  exports: [SearchService, LoggingService],
})
export class LoggingModule {}
