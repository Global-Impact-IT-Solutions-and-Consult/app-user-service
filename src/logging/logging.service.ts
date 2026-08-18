import { Injectable, Logger } from '@nestjs/common';
import { SearchService } from './search.service';
import { QueryLogsDto } from './dto/query-logs.dto';

type CreateLogInput = {
  companyId: string;
  environment: string;
  receiptId?: string;
  eventType: string;
  processingStage?: string;
  message?: string;
  level?: string;
  metadata?: Record<string, any>;
  data?: Record<string, any>;
};

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(private searchService: SearchService) {}

  async queryLogs(
    queryDto: QueryLogsDto & { companyId?: string; environment?: string },
  ) {
    return this.searchService.queryLogs(queryDto);
  }

  async createLog(logData: CreateLogInput) {
    return this.searchService.createLog(logData);
  }

  /** Best-effort write; never throws (callers must not fail because of audit logs). */
  async safeCreateLog(logData: CreateLogInput): Promise<void> {
    try {
      await this.searchService.createLog(logData);
    } catch (error: any) {
      this.logger.warn(
        `Failed to write log ${logData.eventType}: ${error?.message || error}`,
      );
    }
  }
}
