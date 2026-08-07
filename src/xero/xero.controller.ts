import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Logger,
  HttpException,
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
import { XeroService } from './xero.service';
import {
  SetXeroTenantDto,
  SyncXeroInvoicesDto,
} from './dto/sync-invoices.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('xero')
@Controller('xero')
export class XeroController {
  private readonly logger = new Logger(XeroController.name);

  constructor(private xeroService: XeroService) {}

  @Get('callback')
  @ApiOperation({
    summary:
      'OAuth callback from Xero (public). Exchanges code for tokens and selects a tenant.',
  })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true, description: 'companyId' })
  @ApiResponse({ status: 200, description: 'Connected' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const successRedirect = process.env.XERO_SUCCESS_REDIRECT_URL || undefined;

    try {
      const connection = await this.xeroService.handleOAuthCallback(
        code,
        state,
      );

      if (successRedirect) {
        const url = new URL(successRedirect);
        url.searchParams.set('xero', 'connected');
        url.searchParams.set('companyId', state);
        if (connection.tenantId) {
          url.searchParams.set('tenantId', connection.tenantId);
        }
        return res.redirect(url.toString());
      }

      return res.json({
        connected: true,
        companyId: state,
        tenantId: connection.tenantId,
        tenantName: connection.tenantName,
        message:
          'Xero connected. Call POST /xero/:companyId/sync (or wait for the 10-min poller) to pull invoices.',
      });
    } catch (error) {
      const message = this.extractErrorMessage(error);

      this.logger.error(
        `Xero OAuth callback failed for company ${state}: ${message}`,
      );

      if (successRedirect) {
        const url = new URL(successRedirect);
        url.searchParams.set('xero', 'error');
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
    return 'Failed to connect Xero';
  }

  @Get(':companyId/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Get Xero OAuth URL for this company (open in browser to authorize)',
  })
  @ApiParam({ name: 'companyId' })
  async connect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.getAuthorizationUrl(companyId);
  }

  @Get(':companyId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Xero connection / sync status' })
  @ApiParam({ name: 'companyId' })
  async status(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.getConnectionStatus(companyId);
  }

  @Delete(':companyId/connection')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disconnect Xero for this company' })
  @ApiParam({ name: 'companyId' })
  async disconnect(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.disconnect(companyId);
  }

  @Get(':companyId/tenants')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List Xero organisations (tenants) available for this connection',
  })
  @ApiParam({ name: 'companyId' })
  async listTenants(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.listTenants(companyId);
  }

  @Put(':companyId/tenant')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Select which Xero organisation to sync' })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: SetXeroTenantDto })
  async setTenant(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SetXeroTenantDto,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.setTenant(companyId, dto);
  }

  @Post(':companyId/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Manually poll Xero invoices updated since lastSyncedAt (also runs every 10 minutes)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: SyncXeroInvoicesDto, required: false })
  async sync(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SyncXeroInvoicesDto,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.syncInvoices(companyId, dto || {});
  }

  @Get(':companyId/invoices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List recent Xero sales invoices (ACCREC)' })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async listInvoices(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.listInvoices(
      companyId,
      page || 1,
      pageSize || 25,
    );
  }

  @Get(':companyId/invoices/:invoiceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get one Xero invoice by ID' })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async getInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.getInvoice(companyId, invoiceId);
  }

  @Post(':companyId/invoices/:invoiceId/import')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Pull one invoice (+ PDF) from Xero and submit to the receipt service',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async importInvoice(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.importAndProcessInvoice(companyId, invoiceId);
  }

  @Get(':companyId/jobs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List Xero invoice processing jobs' })
  @ApiParam({ name: 'companyId' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  async listJobs(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.listJobs(companyId, page || 1, perPage || 25);
  }

  @Get(':companyId/jobs/:jobId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get one Xero job (refreshes receipt processing status)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'jobId' })
  async getJob(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.xeroService.assertCompanyMember(companyId, user.userId);
    return this.xeroService.getJob(companyId, jobId);
  }
}
