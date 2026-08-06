import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ZohoBooksService } from './zoho-books.service';
import { ImportInvoiceDto } from './dto/import-invoice.dto';
import { SyncZohoInvoicesDto } from './dto/sync-invoices.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

/**
 * Zoho Books OAuth + poll (primary frontend integration).
 * Same shape as QuickBooks: connect → sync/cron → jobs.
 */
@ApiTags('zoho-books')
@Controller('zoho-books')
export class ZohoBooksController {
  private readonly logger = new Logger(ZohoBooksController.name);

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
    const successRedirect = process.env.ZOHO_SUCCESS_REDIRECT_URL || undefined;

    try {
      const connection = await this.zohoBooksService.handleOAuthCallback(
        code,
        state,
        accountsServer,
      );

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
          'Zoho Books connected. Call POST /zoho-books/:companyId/sync (or wait for the 10-min poller) to pull invoices.',
      });
    } catch (error) {
      const message = this.extractErrorMessage(error);

      this.logger.error(
        `Zoho OAuth callback failed for company ${state}: ${message}`,
      );

      if (successRedirect) {
        const url = new URL(successRedirect);
        url.searchParams.set('zoho', 'error');
        url.searchParams.set('companyId', state);
        url.searchParams.set('message', message);
        return res.redirect(url.toString());
      }

      const status = error instanceof HttpException ? error.getStatus() : 500;
      return res.status(status).json({
        connected: false,
        companyId: state,
        message,
      });
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const responseMessage = (response as { message?: unknown }).message;
        if (typeof responseMessage === 'string') return responseMessage;
        if (Array.isArray(responseMessage)) return responseMessage.join(', ');
      }
      return error.message;
    }
    if (error instanceof Error) return error.message;
    return 'Failed to connect Zoho Books';
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
  @ApiOperation({ summary: 'Zoho OAuth connection / sync status' })
  @ApiParam({ name: 'companyId' })
  async status(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getOauthStatus(companyId);
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
      'Manually poll Zoho for invoices modified since lastSyncedAt (also runs every 10 minutes)',
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
      'Pull one invoice (+ PDF) from Zoho and submit to the receipt service',
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
  @ApiOperation({ summary: 'List Zoho invoice processing jobs' })
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
