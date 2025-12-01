import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { SearchService } from '../logging/search.service';
import { QueryReceiptsDto } from './dto/query-receipts.dto';

@Injectable()
export class ReceiptsService {
  private readonly receiptServiceUrl: string;

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
        this.httpService.get(`${this.receiptServiceUrl}/receipts`, { params }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        {
          message: 'Failed to fetch receipts',
          error: error.response?.data || error.message,
        },
        HttpStatus.BAD_GATEWAY,
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
        this.httpService.get(
          `${this.receiptServiceUrl}/receipts/${receiptId}`,
          {
            params: { companyId, environment },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new HttpException('Receipt not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        {
          message: 'Failed to fetch receipt',
          error: error.response?.data || error.message,
        },
        HttpStatus.BAD_GATEWAY,
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
        this.httpService.get(
          `${this.receiptServiceUrl}/receipts/${receiptId}/download`,
          {
            params: { companyId, environment, format },
            responseType: 'arraybuffer',
          },
        ),
      );

      return {
        data: response.data,
        contentType: response.headers['content-type'] || 'application/pdf',
        filename: `receipt-${receiptId}.${format}`,
      };
    } catch (error: any) {
      throw new HttpException(
        {
          message: 'Failed to download receipt',
          error: error.response?.data || error.message,
        },
        HttpStatus.BAD_GATEWAY,
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
        this.httpService.get(
          `${this.receiptServiceUrl}/receipts/${receiptId}/status`,
          {
            params: { companyId, environment },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        {
          message: 'Failed to fetch receipt status',
          error: error.response?.data || error.message,
        },
        HttpStatus.BAD_GATEWAY,
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
