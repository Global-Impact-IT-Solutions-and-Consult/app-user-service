import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ZohoBooksService } from './zoho-books.service';
import { CreateZohoWebhookDto } from './dto/zoho-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('zoho-books')
@Controller('zoho-books')
export class ZohoBooksController {
  constructor(private zohoBooksService: ZohoBooksService) {}

  @Post('hooks/:webhookToken')
  @ApiOperation({
    summary:
      'Public Zoho Books webhook receiver (unique URL per business). Zoho posts invoices here; also accepts connection tests.',
  })
  @ApiParam({ name: 'webhookToken' })
  @ApiResponse({ status: 200, description: 'Webhook accepted' })
  async inboundWebhook(
    @Param('webhookToken') webhookToken: string,
    @Body() body: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ) {
    const rawBody =
      (req as any).rawBody ||
      (typeof body === 'string' ? body : JSON.stringify(body || {}));
    const isTest =
      body?.event_type === 'connection.test' ||
      body?.eventType === 'connection.test' ||
      body?.source === 'ibookam_simulate';

    return this.zohoBooksService.handleInboundWebhook(
      webhookToken,
      body,
      headers,
      rawBody,
      { isTest },
    );
  }

  @Post(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Create or get this business’s unique Zoho webhook URL (set rotate=true to issue a new URL/secret)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: CreateZohoWebhookDto, required: false })
  async createWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateZohoWebhookDto,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    const payload = dto || {};
    if (payload.rotate) {
      return this.zohoBooksService.rotateWebhookEndpoint(companyId, payload);
    }
    return this.zohoBooksService.createOrGetWebhookEndpoint(companyId, payload);
  }

  @Get(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Webhook status: pending (waiting for Zoho) vs connected, plus last event time',
  })
  @ApiParam({ name: 'companyId' })
  async getWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getWebhookEndpointStatus(companyId);
  }

  @Post(':companyId/webhook/simulate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Simulate a Zoho webhook hit to confirm the link works (marks connected)',
  })
  @ApiParam({ name: 'companyId' })
  async simulateWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.simulateWebhook(companyId);
  }

  @Delete(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable this business Zoho webhook' })
  @ApiParam({ name: 'companyId' })
  async disableWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.disableWebhookEndpoint(companyId);
  }

  @Get(':companyId/jobs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List invoices received from Zoho and their processing status',
  })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async listJobs(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.listJobs(companyId, page || 1, perPage || 25);
  }

  @Get(':companyId/jobs/:jobId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get one Zoho invoice job (refreshes receipt processing status)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'jobId' })
  async getJob(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getJob(companyId, jobId);
  }
}
