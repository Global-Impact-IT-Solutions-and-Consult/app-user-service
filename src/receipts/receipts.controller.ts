import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ReceiptsService } from './receipts.service';
import { QueryReceiptsDto } from './dto/query-receipts.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('receipts')
@ApiBearerAuth('JWT-auth')
@Controller('receipts')
@UseGuards(JwtAuthGuard)
export class ReceiptsController {
  constructor(private receiptsService: ReceiptsService) {}

  @Get()
  @ApiOperation({ summary: 'Query receipts with optional date range filters' })
  @ApiResponse({ status: 200, description: 'List of receipts' })
  async getReceipts(
    @CurrentUser() user: CurrentUserPayload,
    @Query() queryDto: QueryReceiptsDto,
  ) {
    return this.receiptsService.getReceipts(
      user.companyId,
      user.environment,
      queryDto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get receipt details by ID' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt details' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  async getReceipt(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.receiptsService.getReceiptById(id, user.companyId, user.environment);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get receipt status' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiResponse({ status: 200, description: 'Receipt status' })
  async getReceiptStatus(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.receiptsService.getReceiptStatus(id, user.companyId, user.environment);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download receipt in specified format' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiQuery({ name: 'format', required: false, description: 'File format (pdf, json, etc.)', example: 'pdf' })
  @ApiResponse({ status: 200, description: 'Receipt file downloaded' })
  async downloadReceipt(
    @Param('id') id: string,
    @Query('format') format: string = 'pdf',
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const result = await this.receiptsService.downloadReceipt(
      id,
      user.companyId,
      user.environment,
      format,
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get event logs for a specific receipt from ElasticSearch' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', example: 50 })
  @ApiResponse({ status: 200, description: 'List of receipt logs' })
  async getReceiptLogs(
    @Param('id') receiptId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.receiptsService.getReceiptLogs(
      receiptId,
      user.companyId,
      user.environment,
      page,
      limit,
    );
  }
}

