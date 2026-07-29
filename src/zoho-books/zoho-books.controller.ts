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
  Res,
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
import type { Request, Response } from 'express';
import { ZohoBooksService } from './zoho-books.service';
import { CreateZohoWebhookDto } from './dto/zoho-webhook.dto';
import {
  ImportInvoiceDto,
  WriteBackInvoiceDto,
} from './dto/import-invoice.dto';
import { SyncZohoInvoicesDto } from './dto/sync-invoices.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('zoho-books')
@Controller('zoho-books')
export class ZohoBooksController {
  constructor(private zohoBooksService: ZohoBooksService) {}

  @Get('callback')
  @ApiOperation({
    summary: 'OAuth callback from Zoho (public). Exchanges code for tokens.',
  })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true, description: 'companyId' })
  @ApiQuery({ name: 'accounts-server', required: false })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('accounts-server') accountsServer: string | undefined,
    @Res() res: Response,
  ) {
    const connection = await this.zohoBooksService.handleOAuthCallback(
      code,
      state,
      accountsServer,
    );
    const successRedirect = process.env.ZOHO_SUCCESS_REDIRECT_URL || undefined;

    if (successRedirect) {
      const url = new URL(successRedirect);
      url.searchParams.set('zoho', 'connected');
      url.searchParams.set('companyId', state);
      if (connection.organizationId) {
        url.searchParams.set('organizationId', connection.organizationId);
      }
      return res.redirect(url.toString());
    }

    return res.json({
      connected: true,
      companyId: state,
      organizationId: connection.organizationId,
      message:
        'Zoho Books connected. You can now call API endpoints or continue using webhooks.',
    });
  }

  @Get(':companyId/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Get Zoho Books OAuth URL for this company (open in browser to authorize)',
  })
  @ApiParam({ name: 'companyId' })
  async connect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getAuthorizationUrl(companyId);
  }

  @Get(':companyId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Zoho OAuth + webhook status for this company' })
  @ApiParam({ name: 'companyId' })
  async status(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getConnectionStatus(companyId);
  }

  @Delete(':companyId/connection')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disconnect Zoho OAuth for this company' })
  @ApiParam({ name: 'companyId' })
  async disconnect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.disconnect(companyId);
  }

  @Post(':companyId/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Manually poll Zoho for invoices modified since lastSyncedAt (also runs on a 10-minute cron)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: SyncZohoInvoicesDto, required: false })
  async sync(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SyncZohoInvoicesDto,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.syncInvoices(companyId, dto || {});
  }

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

  @Get(':companyId/organizations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List Zoho Books organizations for the connected account' })
  @ApiParam({ name: 'companyId' })
  async listOrganizations(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.listOrganizations(companyId);
  }

  @Get(':companyId/invoices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List invoices from Zoho Books (OAuth)' })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async listInvoices(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.listInvoices(
      companyId,
      page || 1,
      perPage || 25,
    );
  }

  @Get(':companyId/invoices/:invoiceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get one Zoho Books invoice by ID' })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async getInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getInvoice(companyId, invoiceId);
  }

  @Post(':companyId/invoices/:invoiceId/import')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Pull invoice (+ PDF) from Zoho and submit to the receipt service for processing',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  @ApiBody({ type: ImportInvoiceDto, required: false })
  async importInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ImportInvoiceDto,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.importAndProcessInvoice(
      companyId,
      invoiceId,
      user.environment || 'test',
      dto || {},
    );
  }

  @Get(':companyId/jobs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List invoice processing jobs (webhook or OAuth import)',
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

  @Post(':companyId/jobs/:jobId/write-back')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Write processing results back to the Zoho invoice',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'jobId' })
  @ApiBody({ type: WriteBackInvoiceDto, required: false })
  async writeBack(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: WriteBackInvoiceDto,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.writeBackByJobId(companyId, jobId, dto || {});
  }
}
