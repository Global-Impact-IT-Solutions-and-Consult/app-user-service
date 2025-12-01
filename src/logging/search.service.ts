import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { Log } from './entities/log.entity';
import { QueryLogsDto } from './dto/query-logs.dto';

export interface LogQueryParams {
  companyId?: string;
  environment?: string;
  receiptId?: string;
  eventType?: string;
  processingStage?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string; // General text search across multiple fields
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Log)
    private logRepository: Repository<Log>,
  ) {}

  async queryLogs(params: LogQueryParams | QueryLogsDto) {
    const combinedParams = params as LogQueryParams & QueryLogsDto;
    const {
      page = 1,
      limit = 50,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      search,
      ...filters
    } = combinedParams;

    const skip = (page - 1) * limit;

    // Build TypeORM query builder
    const queryBuilder = this.logRepository.createQueryBuilder('log');

    // Exact match filters
    if (filters.companyId) {
      queryBuilder.andWhere('log.companyId = :companyId', {
        companyId: filters.companyId,
      });
    }

    if (filters.environment) {
      queryBuilder.andWhere('log.environment = :environment', {
        environment: filters.environment,
      });
    }

    if (filters.receiptId) {
      queryBuilder.andWhere('log.receiptId = :receiptId', {
        receiptId: filters.receiptId,
      });
    }

    if (filters.eventType) {
      queryBuilder.andWhere('log.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (filters.processingStage) {
      queryBuilder.andWhere('log.processingStage = :processingStage', {
        processingStage: filters.processingStage,
      });
    }

    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      const dateFrom = filters.dateFrom
        ? new Date(filters.dateFrom)
        : new Date(0);
      const dateTo = filters.dateTo ? new Date(filters.dateTo) : new Date();
      queryBuilder.andWhere('log.timestamp BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      });
    }

    // Text search across multiple fields
    if (search) {
      queryBuilder.andWhere(
        '(log.eventType ILIKE :search OR log.processingStage ILIKE :search OR log.message ILIKE :search OR log.level ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Sorting
    queryBuilder.orderBy(
      `log.${sortBy}`,
      sortOrder.toUpperCase() as 'ASC' | 'DESC',
    );

    // Pagination
    queryBuilder.skip(skip).take(limit);

    try {
      // Execute query with pagination
      const [logs, total] = await queryBuilder.getManyAndCount();

      return {
        logs: logs.map((log) => ({
          id: log.id,
          companyId: log.companyId,
          environment: log.environment,
          receiptId: log.receiptId,
          eventType: log.eventType,
          processingStage: log.processingStage,
          timestamp: log.timestamp,
          message: log.message,
          level: log.level,
          metadata: log.metadata,
          data: log.data,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      console.error('Search query failed:', error.message);
      throw new Error(`Search query failed: ${error.message}`);
    }
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
  }): Promise<Log> {
    const log = this.logRepository.create({
      ...logData,
      companyId: logData.companyId,
      receiptId: logData.receiptId,
      timestamp: new Date(),
    });

    return this.logRepository.save(log);
  }
}
