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
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { QuickBooksService } from './quickbooks.service';
import { SyncQuickBooksInvoicesDto } from './dto/sync-invoices.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('quickbooks')
@Controller('quickbooks')
export class QuickBooksController {
  private readonly logger = new Logger(QuickBooksController.name);

  constructor(private quickBooksService: QuickBooksService) {}

  @Get('callback')
  @ApiOperation({
    summary:
      'OAuth callback from Intuit (public). Exchanges code for tokens; realmId is the QBO company.',
  })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true, description: 'companyId' })
  @ApiQuery({ name: 'realmId', required: true })
  @ApiResponse({ status: 200, description: 'Connected' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('realmId') realmId: string,
    @Res() res: Response,
  ) {
    const successRedirect = process.env.QUICKBOOKS_SUCCESS_REDIRECT_URL;

    try {
      const connection = await this.quickBooksService.handleOAuthCallback(
        code,
        state,
        realmId,
      );

      if (successRedirect) {
        const url = new URL(successRedirect);
        url.searchParams.set('quickbooks', 'connected');
        url.searchParams.set('companyId', state);
        url.searchParams.set('realmId', connection.realmId);
        return res.redirect(url.toString());
      }

      return res.json({
        connected: true,
        companyId: state,
        realmId: connection.realmId,
        message:
          'QuickBooks connected. Call POST /quickbooks/:companyId/sync (or wait for the 10-min poller) to pull invoices.',
      });
    } catch (error) {
      const message = this.extractErrorMessage(error);

      this.logger.error(
        `QuickBooks OAuth callback failed for company ${state}: ${message}`,
      );

      if (successRedirect) {
        const url = new URL(successRedirect);
        url.searchParams.set('quickbooks', 'error');
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
    return 'Failed to connect QuickBooks';
  }

  @Get(':companyId/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Get QuickBooks Online OAuth URL for this company (open in browser to authorize)',
  })
  @ApiParam({ name: 'companyId' })
  async connect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.getAuthorizationUrl(companyId);
  }

  @Get(':companyId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'QuickBooks connection / sync status' })
  @ApiParam({ name: 'companyId' })
  async status(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.getConnectionStatus(companyId);
  }

  @Delete(':companyId/connection')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disconnect QuickBooks for this company' })
  @ApiParam({ name: 'companyId' })
  async disconnect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.disconnect(companyId);
  }

  @Post(':companyId/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Manually poll QuickBooks invoices updated since lastSyncedAt (also runs every 10 minutes)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: SyncQuickBooksInvoicesDto, required: false })
  async sync(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SyncQuickBooksInvoicesDto,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.syncInvoices(companyId, dto || {});
  }

  @Get(':companyId/invoices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List recent QuickBooks invoices' })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'maxResults', required: false })
  async listInvoices(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('maxResults') maxResults?: number,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.listInvoices(companyId, maxResults || 25);
  }

  @Get(':companyId/invoices/:invoiceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get one QuickBooks invoice by ID' })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async getInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.getInvoice(companyId, invoiceId);
  }

  @Post(':companyId/invoices/:invoiceId/import')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Pull one invoice (+ PDF) from QuickBooks and submit to the receipt service',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async importInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.importAndProcessInvoice(companyId, invoiceId);
  }

  @Get(':companyId/jobs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List QuickBooks invoice processing jobs' })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async listJobs(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.listJobs(
      companyId,
      page || 1,
      perPage || 25,
    );
  }

  @Get(':companyId/jobs/:jobId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get one QuickBooks job (refreshes receipt processing status)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'jobId' })
  async getJob(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.quickBooksService.assertCompanyMember(companyId, user.userId);
    return this.quickBooksService.getJob(companyId, jobId);
  }
}
