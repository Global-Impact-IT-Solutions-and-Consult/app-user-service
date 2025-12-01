import { Injectable } from '@nestjs/common';
import { SearchService } from './search.service';
import { QueryLogsDto } from './dto/query-logs.dto';

@Injectable()
export class LoggingService {
  constructor(private searchService: SearchService) {}

  async queryLogs(
    queryDto: QueryLogsDto & { companyId?: string; environment?: string },
  ) {
    return this.searchService.queryLogs(queryDto);
  }

  async createLog(logData: {
    companyId: string;
    environment: string;
    receiptId?: string;
    eventType: string;
    processingStage?: string;
    message?: string;
    level?: string;
    metadata?: Record<string, any>;
    data?: Record<string, any>;
  }) {
    return this.searchService.createLog(logData);
  }
}
