import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { SearchService } from '../logging/search.service';
import { QueryReceiptsDto } from './dto/query-receipts.dto';

@Injectable()
export class ReceiptsService {
  private readonly receiptServiceUrl: string;
  private readonly logger = new Logger(ReceiptsService.name);
  private readonly requestTimeout = 30000; // 30 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly searchService: SearchService,
  ) {
    this.receiptServiceUrl =
      this.configService.get<string>('RECEIPT_SERVICE_URL') ||
      'http://localhost:3001';
  }

  async getReceipts(
    companyId: string,
    environment: string,
    queryDto: QueryReceiptsDto,
  ) {
    try {
      const params: any = {
        companyId,
        environment,
        page: queryDto.page || 1,
        limit: queryDto.limit || 20,
      };

      if (queryDto.dateFrom) {
        params.dateFrom = queryDto.dateFrom;
      }
      if (queryDto.dateTo) {
        params.dateTo = queryDto.dateTo;
      }

      const response = await firstValueFrom(
        this.httpService
          .get(`${this.receiptServiceUrl}/receipts`, { params })
          .pipe(timeout(this.requestTimeout)),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch receipts for company ${companyId}: ${error.message}`,
        error.stack,
      );

      // Handle timeout errors
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        throw new HttpException(
          {
            message: 'Receipt service request timed out',
            error: 'The receipt service did not respond in time',
            serviceUrl: this.receiptServiceUrl,
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      // Handle network/connection errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET'
      ) {
        throw new HttpException(
          {
            message: 'Receipt service is unavailable',
            error: `Cannot connect to receipt service at ${this.receiptServiceUrl}`,
            serviceUrl: this.receiptServiceUrl,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Handle HTTP errors from the service
      if (error.response) {
        const status = error.response.status || HttpStatus.BAD_GATEWAY;
        const errorData = error.response.data || { message: 'Unknown error' };

        throw new HttpException(
          {
            message: 'Failed to fetch receipts from receipt service',
            error: errorData,
            statusCode: status,
          },
          status >= 500 ? HttpStatus.BAD_GATEWAY : status,
        );
      }

      // Handle other errors
      throw new HttpException(
        {
          message: 'Failed to fetch receipts',
          error: error.message || 'Unknown error occurred',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getReceiptById(
    receiptId: string,
    companyId: string,
    environment: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get(`${this.receiptServiceUrl}/receipts/${receiptId}`, {
            params: { companyId, environment },
          })
          .pipe(timeout(this.requestTimeout)),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch receipt ${receiptId} for company ${companyId}: ${error.message}`,
        error.stack,
      );

      if (error.response?.status === 404) {
        throw new HttpException('Receipt not found', HttpStatus.NOT_FOUND);
      }

      // Handle timeout errors
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        throw new HttpException(
          {
            message: 'Receipt service request timed out',
            error: 'The receipt service did not respond in time',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      // Handle network/connection errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET'
      ) {
        throw new HttpException(
          {
            message: 'Receipt service is unavailable',
            error: `Cannot connect to receipt service at ${this.receiptServiceUrl}`,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Handle HTTP errors from the service
      if (error.response) {
        const status = error.response.status || HttpStatus.BAD_GATEWAY;
        throw new HttpException(
          {
            message: 'Failed to fetch receipt from receipt service',
            error: error.response.data || { message: 'Unknown error' },
            statusCode: status,
          },
          status >= 500 ? HttpStatus.BAD_GATEWAY : status,
        );
      }

      throw new HttpException(
        {
          message: 'Failed to fetch receipt',
          error: error.message || 'Unknown error occurred',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async downloadReceipt(
    receiptId: string,
    companyId: string,
    environment: string,
    format = 'pdf',
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get(`${this.receiptServiceUrl}/receipts/${receiptId}/download`, {
            params: { companyId, environment, format },
            responseType: 'arraybuffer',
          })
          .pipe(timeout(this.requestTimeout)),
      );

      return {
        data: response.data,
        contentType: response.headers['content-type'] || 'application/pdf',
        filename: `receipt-${receiptId}.${format}`,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to download receipt ${receiptId} for company ${companyId}: ${error.message}`,
        error.stack,
      );

      if (error.response?.status === 404) {
        throw new HttpException('Receipt not found', HttpStatus.NOT_FOUND);
      }

      // Handle timeout errors
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        throw new HttpException(
          {
            message: 'Receipt service request timed out',
            error: 'The receipt service did not respond in time',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      // Handle network/connection errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET'
      ) {
        throw new HttpException(
          {
            message: 'Receipt service is unavailable',
            error: `Cannot connect to receipt service at ${this.receiptServiceUrl}`,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Handle HTTP errors from the service
      if (error.response) {
        const status = error.response.status || HttpStatus.BAD_GATEWAY;
        throw new HttpException(
          {
            message: 'Failed to download receipt from receipt service',
            error: error.response.data || { message: 'Unknown error' },
            statusCode: status,
          },
          status >= 500 ? HttpStatus.BAD_GATEWAY : status,
        );
      }

      throw new HttpException(
        {
          message: 'Failed to download receipt',
          error: error.message || 'Unknown error occurred',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getReceiptStatus(
    receiptId: string,
    companyId: string,
    environment: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get(`${this.receiptServiceUrl}/receipts/${receiptId}/status`, {
            params: { companyId, environment },
          })
          .pipe(timeout(this.requestTimeout)),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch receipt status ${receiptId} for company ${companyId}: ${error.message}`,
        error.stack,
      );

      if (error.response?.status === 404) {
        throw new HttpException('Receipt not found', HttpStatus.NOT_FOUND);
      }

      // Handle timeout errors
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        throw new HttpException(
          {
            message: 'Receipt service request timed out',
            error: 'The receipt service did not respond in time',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      // Handle network/connection errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET'
      ) {
        throw new HttpException(
          {
            message: 'Receipt service is unavailable',
            error: `Cannot connect to receipt service at ${this.receiptServiceUrl}`,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Handle HTTP errors from the service
      if (error.response) {
        const status = error.response.status || HttpStatus.BAD_GATEWAY;
        throw new HttpException(
          {
            message: 'Failed to fetch receipt status from receipt service',
            error: error.response.data || { message: 'Unknown error' },
            statusCode: status,
          },
          status >= 500 ? HttpStatus.BAD_GATEWAY : status,
        );
      }

      throw new HttpException(
        {
          message: 'Failed to fetch receipt status',
          error: error.message || 'Unknown error occurred',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getReceiptLogs(
    receiptId: string,
    companyId: string,
    environment: string,
    page = 1,
    limit = 50,
  ) {
    return this.searchService.queryLogs({
      receiptId,
      companyId,
      environment,
      page,
      limit,
    });
  }
}
