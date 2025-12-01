import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Log, LogDocument } from './schemas/log.schema';
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
  constructor(@InjectModel(Log.name) private logModel: Model<LogDocument>) {}

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

    // Build MongoDB query
    const query: any = {};

    // Exact match filters
    if (filters.companyId) {
      query.companyId = filters.companyId;
    }

    if (filters.environment) {
      query.environment = filters.environment;
    }

    if (filters.receiptId) {
      query.receiptId = filters.receiptId;
    }

    if (filters.eventType) {
      query.eventType = filters.eventType;
    }

    if (filters.processingStage) {
      query.processingStage = filters.processingStage;
    }

    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      query.timestamp = {};
      if (filters.dateFrom) {
        query.timestamp.$gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        query.timestamp.$lte = new Date(filters.dateTo);
      }
    }

    // Text search across multiple fields
    if (search) {
      query.$or = [
        { eventType: { $regex: search, $options: 'i' } },
        { processingStage: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
        { level: { $regex: search, $options: 'i' } },
      ];
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    try {
      // Execute query with pagination
      const [logs, total] = await Promise.all([
        this.logModel
          .find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.logModel.countDocuments(query).exec(),
      ]);

      return {
        logs: logs.map((log) => ({
          id: log._id.toString(),
          companyId: log.companyId?.toString(),
          environment: log.environment,
          receiptId: log.receiptId?.toString(),
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
  }): Promise<LogDocument> {
    const log = new this.logModel({
      ...logData,
      companyId: logData.companyId,
      receiptId: logData.receiptId,
      timestamp: new Date(),
    });

    return log.save();
  }
}
