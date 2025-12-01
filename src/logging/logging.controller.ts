import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { LoggingService } from './logging.service';
import { QueryLogsDto } from './dto/query-logs.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('logs')
@ApiBearerAuth('JWT-auth')
@Controller('logs')
@UseGuards(JwtAuthGuard)
export class LoggingController {
  constructor(private loggingService: LoggingService) {}

  @Get()
  @ApiOperation({
    summary: 'Search logs with flexible multi-field filtering',
    description:
      'Returns paginated logs with flexible search across multiple fields (company, environment, receipt ID, event type, processing stage, date range, and text search)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated log results',
    schema: {
      example: {
        logs: [
          {
            id: 'log123',
            receiptId: 'receipt456',
            eventType: 'receipt.created',
            processingStage: 'processing',
            timestamp: '2024-01-01T00:00:00Z',
            companyId: 'company789',
            environment: 'test',
          },
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 100,
          totalPages: 2,
        },
      },
    },
  })
  async getLogs(
    @Query() queryDto: QueryLogsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    // Enforce company and environment from JWT
    return this.loggingService.queryLogs({
      ...queryDto,
      companyId: user.companyId,
      environment: user.environment,
    });
  }
}
