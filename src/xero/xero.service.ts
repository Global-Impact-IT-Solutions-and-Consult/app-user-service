import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { XeroConnection } from './entities/xero-connection.entity';
import {
  XeroInvoiceJob,
  XeroInvoiceJobStatus,
} from './entities/xero-invoice-job.entity';
import { Company } from '../companies/entities/company.entity';
import { EncryptionUtil } from '../common/utils/encryption.util';
import { ReceiptsService } from '../receipts/receipts.service';
import { LoggingService } from '../logging/logging.service';
import {
  SetXeroTenantDto,
  SyncXeroInvoicesDto,
} from './dto/sync-invoices.dto';

@Injectable()
export class XeroService {
  private readonly logger = new Logger(XeroService.name);

  constructor(
    @InjectRepository(XeroConnection)
    private xeroConnectionRepository: Repository<XeroConnection>,
    @InjectRepository(XeroInvoiceJob)
    private xeroInvoiceJobRepository: Repository<XeroInvoiceJob>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private configService: ConfigService,
    private receiptsService: ReceiptsService,
    private loggingService: LoggingService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('XERO_CLIENT_ID') &&
        this.configService.get<string>('XERO_CLIENT_SECRET'),
    );
  }

  private getAuthUrl(): string {
    return (
      this.configService.get<string>('XERO_AUTH_URL') ||
      'https://login.xero.com/identity/connect/authorize'
    );
  }

  private getTokenUrl(): string {
    return (
      this.configService.get<string>('XERO_TOKEN_URL') ||
      'https://identity.xero.com/connect/token'
    );
  }

  private getConnectionsUrl(): string {
    return (
      this.configService.get<string>('XERO_CONNECTIONS_URL') ||
      'https://api.xero.com/connections'
    );
  }

  private getRedirectUri(): string {
    return (
      this.configService.get<string>('XERO_REDIRECT_URI') ||
      'http://localhost:4002/api/xero/callback'
    );
  }

  private getScopes(): string {
    return (
      this.configService.get<string>('XERO_SCOPES') ||
      [
        'openid',
        'profile',
        'email',
        'offline_access',
        'accounting.invoices',
        'accounting.contacts.read',
      ].join(' ')
    );
  }

  private getApiBaseUrl(): string {
    return (
      this.configService.get<string>('XERO_API_BASE_URL') ||
      'https://api.xero.com'
    );
  }

  private getBasicAuthHeader(): string {
    const clientId = this.configService.get<string>('XERO_CLIENT_ID')!;
    const clientSecret = this.configService.get<string>('XERO_CLIENT_SECRET')!;
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  getAuthorizationUrl(companyId: string): { url: string } {
    this.assertConfigured();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.configService.get<string>('XERO_CLIENT_ID')!,
      redirect_uri: this.getRedirectUri(),
      scope: this.getScopes(),
      state: companyId,
    });

    return { url: `${this.getAuthUrl()}?${params.toString()}` };
  }

  async handleOAuthCallback(
    code: string,
    companyId: string,
  ): Promise<XeroConnection> {
    this.assertConfigured();

    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const tokenResponse = await axios.post(
      this.getTokenUrl(),
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getRedirectUri(),
      }).toString(),
      {
        headers: {
          Authorization: this.getBasicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    if (!access_token || !refresh_token) {
      throw new BadRequestException(
        'Xero did not return access/refresh tokens.',
      );
    }

    const tenants = await this.fetchConnections(access_token);
    if (!tenants.length) {
      throw new BadRequestException(
        'No Xero organisations found for this account',
      );
    }

    let connection = await this.xeroConnectionRepository.findOne({
      where: { companyId },
    });
    if (!connection) {
      connection = this.xeroConnectionRepository.create({ companyId });
    }

    connection.accessToken = EncryptionUtil.encrypt(access_token);
    connection.refreshToken = EncryptionUtil.encrypt(refresh_token);
    connection.expiresAt = new Date(Date.now() + (expires_in || 1800) * 1000);
    connection.apiBaseUrl = this.getApiBaseUrl();
    connection.isActive = true;
    connection.pollingEnabled = true;
    connection.environment =
      this.configService.get<string>('XERO_DEFAULT_ENVIRONMENT') || 'test';

    const configuredTenantId = this.configService.get<string>('XERO_TENANT_ID');
    const selected =
      (configuredTenantId &&
        tenants.find((t) => String(t.tenantId) === configuredTenantId)) ||
      tenants[0];

    connection.tenantId = String(selected.tenantId);
    connection.tenantName = selected.tenantName || null;

    const saved = await this.xeroConnectionRepository.save(connection);
    await this.logErpEvent(companyId, 'xero.connected', 'Xero connected', {
      environment: saved.environment || 'test',
      metadata: {
        tenantId: saved.tenantId,
        tenantName: saved.tenantName,
      },
    });
    return saved;
  }

  async getConnectionStatus(companyId: string) {
    const connection = await this.xeroConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });

    if (!connection) {
      return {
        connected: false,
        configured: this.isConfigured(),
        message: this.isConfigured()
          ? 'Not connected. Start OAuth via GET /xero/:companyId/connect'
          : 'Xero is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
      };
    }

    return {
      connected: true,
      configured: true,
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      apiBaseUrl: connection.apiBaseUrl,
      lastSyncedAt: connection.lastSyncedAt,
      pollingEnabled: connection.pollingEnabled,
      environment: connection.environment,
      expiresAt: connection.expiresAt,
      connectedAt: connection.createdAt,
    };
  }

  async disconnect(companyId: string): Promise<{ message: string }> {
    const connection = await this.requireConnection(companyId);
    connection.isActive = false;
    connection.pollingEnabled = false;
    await this.xeroConnectionRepository.save(connection);
    await this.logErpEvent(companyId, 'xero.disconnected', 'Xero disconnected', {
      environment: connection.environment || 'test',
    });
    return { message: 'Xero disconnected' };
  }

  async updatePolling(
    companyId: string,
    pollingEnabled: boolean,
  ): Promise<{ pollingEnabled: boolean }> {
    const connection = await this.requireConnection(companyId);
    connection.pollingEnabled = pollingEnabled;
    await this.xeroConnectionRepository.save(connection);
    return { pollingEnabled: connection.pollingEnabled };
  }

  async listTenants(companyId: string) {
    let connection = await this.requireConnection(companyId, {
      requireTenant: false,
    });
    connection = await this.refreshTokenIfNeeded(connection);
    const accessToken = EncryptionUtil.decrypt(connection.accessToken);
    const tenants = await this.fetchConnections(accessToken);
    return {
      currentTenantId: connection.tenantId,
      tenants,
    };
  }

  async setTenant(companyId: string, dto: SetXeroTenantDto) {
    const connection = await this.requireConnection(companyId, {
      requireTenant: false,
    });
    const previousTenantId = connection.tenantId;
    connection.tenantId = dto.tenantId;
    if (dto.tenantName) {
      connection.tenantName = dto.tenantName;
    }
    await this.xeroConnectionRepository.save(connection);
    await this.logErpEvent(
      companyId,
      'xero.tenant.updated',
      'Xero organisation selected',
      {
        environment: connection.environment || 'test',
        metadata: {
          tenantId: connection.tenantId,
          tenantName: connection.tenantName,
          previousTenantId,
        },
      },
    );
    return {
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollAllConnectedCompanies() {
    const enabled =
      this.configService.get<string>('XERO_POLLING_ENABLED') !== 'false';
    if (!enabled) {
      return;
    }

    const connections = await this.xeroConnectionRepository.find({
      where: { isActive: true, pollingEnabled: true },
    });

    for (const connection of connections) {
      try {
        await this.syncInvoices(connection.companyId, {}, 'poll');
      } catch (error: any) {
        this.logger.error(
          `Xero poll failed for company ${connection.companyId}: ${error.message}`,
        );
        await this.logErpEvent(
          connection.companyId,
          'xero.sync.failed',
          `Xero poll failed: ${error.message}`,
          {
            level: 'error',
            environment: connection.environment || 'test',
            metadata: { trigger: 'poll', error: error.message },
          },
        );
      }
    }
  }

  /**
   * Poll invoices modified since lastSyncedAt using If-Modified-Since.
   */
  async syncInvoices(
    companyId: string,
    dto: SyncXeroInvoicesDto = {},
    trigger: 'manual' | 'poll' = 'manual',
  ) {
    const connection = await this.requireConnection(companyId);

    try {
    const client = await this.getAuthedClient(companyId);

    const sinceDate =
      (dto.since && new Date(dto.since)) ||
      connection.lastSyncedAt ||
      new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (Number.isNaN(sinceDate.getTime())) {
      throw new BadRequestException('Invalid since timestamp');
    }

    const invoices: any[] = [];
    let page = 1;

    while (page <= 20) {
      const { data, status } = await client.get('/api.xro/2.0/Invoices', {
        params: {
          page,
          where: 'Type=="ACCREC"',
          order: 'UpdatedDateUTC ASC',
        },
        headers: {
          'If-Modified-Since': sinceDate.toUTCString(),
        },
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      });

      if (status === 304) {
        break;
      }

      const batch = data?.Invoices || [];
      invoices.push(...batch);

      if (batch.length < 100) {
        break;
      }
      page += 1;
    }

    const imported: Array<Record<string, unknown>> = [];
    const skipped: string[] = [];

    for (const invoice of invoices) {
      const invoiceId = String(invoice.InvoiceID || '');
      if (!invoiceId) {
        continue;
      }

      const existing = await this.xeroInvoiceJobRepository.find({
        where: { companyId, xeroInvoiceId: invoiceId },
        order: { createdAt: 'DESC' },
        take: 1,
      });
      const job = existing[0];
      if (job && job.status !== XeroInvoiceJobStatus.FAILED) {
        skipped.push(invoiceId);
        continue;
      }

      const result = await this.importAndProcessInvoice(companyId, invoiceId, {
        submitForProcessing: dto.submitForProcessing !== false,
        invoiceSnapshot: invoice,
      });
      imported.push(result);
    }

    connection.lastSyncedAt = new Date();
    await this.xeroConnectionRepository.save(connection);

    const result = {
      since: sinceDate.toISOString(),
      fetched: invoices.length,
      imported: imported.length,
      skipped: skipped.length,
      lastSyncedAt: connection.lastSyncedAt,
      jobs: imported,
    };
    await this.logErpEvent(
      companyId,
      'xero.sync.completed',
      'Xero invoice sync completed',
      {
        environment: connection.environment || 'test',
        metadata: {
          trigger,
          since: result.since,
          fetched: result.fetched,
          imported: result.imported,
          skipped: result.skipped,
        },
      },
    );
    return result;
    } catch (error: any) {
      if (trigger === 'manual') {
        await this.logErpEvent(
          companyId,
          'xero.sync.failed',
          `Xero invoice sync failed: ${error.message}`,
          {
            level: 'error',
            environment: connection.environment || 'test',
            metadata: { trigger, error: error.message },
          },
        );
      }
      throw error;
    }
  }

  async listInvoices(companyId: string, page = 1, _pageSize = 25) {
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get('/api.xro/2.0/Invoices', {
      params: {
        page,
        where: 'Type=="ACCREC"',
        order: 'UpdatedDateUTC DESC',
      },
    });
    return {
      invoices: data?.Invoices || [],
    };
  }

  async getInvoice(companyId: string, invoiceId: string) {
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get(`/api.xro/2.0/Invoices/${invoiceId}`);
    const invoices = data?.Invoices || [];
    return invoices[0] || data;
  }

  async importAndProcessInvoice(
    companyId: string,
    invoiceId: string,
    options: {
      submitForProcessing?: boolean;
      invoiceSnapshot?: any;
    } = {},
  ) {
    const connection = await this.requireConnection(companyId);
    const invoice =
      options.invoiceSnapshot || (await this.getInvoice(companyId, invoiceId));

    let pdf: { buffer: Buffer; filename: string; contentType: string } | null =
      null;
    try {
      pdf = await this.downloadInvoicePdf(companyId, invoiceId);
    } catch (error: any) {
      this.logger.warn(
        `Could not download Xero invoice PDF ${invoiceId}: ${error.message}`,
      );
    }

    const existingJobs = await this.xeroInvoiceJobRepository.find({
      where: { companyId, xeroInvoiceId: String(invoiceId) },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let job =
      existingJobs[0] ||
      this.xeroInvoiceJobRepository.create({
        companyId,
        xeroInvoiceId: String(invoiceId),
      });

    job.xeroInvoiceNumber =
      invoice.InvoiceNumber || invoice.invoiceNumber || job.xeroInvoiceNumber;
    job.environment = connection.environment || 'test';
    job.sourcePayload = {
      ...invoice,
      _source: 'xero_poll',
    };
    job.status = XeroInvoiceJobStatus.IMPORTED;
    job.error = null;
    job = await this.xeroInvoiceJobRepository.save(job);

    if (options.submitForProcessing === false) {
      return this.toJobResponse(job, { pdfDownloaded: Boolean(pdf) });
    }

    try {
      const submitted = await this.receiptsService.submitForProcessing({
        companyId,
        environment: job.environment,
        file: pdf?.buffer,
        filename:
          pdf?.filename ||
          `xero-invoice-${job.xeroInvoiceNumber || invoiceId}.pdf`,
        contentType: pdf?.contentType || 'application/pdf',
        metadata: {
          source: 'xero',
          xeroInvoiceId: job.xeroInvoiceId,
          xeroInvoiceNumber: job.xeroInvoiceNumber,
          invoice,
          jobId: job.id,
        },
      });

      job.receiptId =
        submitted?.id ||
        submitted?.receiptId ||
        submitted?.receipt?.id ||
        job.receiptId;
      job.status = XeroInvoiceJobStatus.SUBMITTED;
      job.processedPayload = submitted as Record<string, unknown>;
      job = await this.xeroInvoiceJobRepository.save(job);
      job = await this.refreshJobFromReceiptService(job);
    } catch (error: any) {
      const message =
        error instanceof HttpException
          ? JSON.stringify(error.getResponse())
          : error.message;
      job.status = XeroInvoiceJobStatus.FAILED;
      job.error = `Receipt service submit failed: ${message}`;
      job = await this.xeroInvoiceJobRepository.save(job);
      this.logger.error(
        `Xero invoice submit failed for ${invoiceId}: ${message}`,
      );
    }

    return this.toJobResponse(job, { pdfDownloaded: Boolean(pdf) });
  }

  async listJobs(companyId: string, page = 1, perPage = 25) {
    const [items, total] = await this.xeroInvoiceJobRepository.findAndCount({
      where: { companyId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return {
      items: items.map((job) => this.toJobResponse(job)),
      total,
      page,
      perPage,
    };
  }

  async getJob(companyId: string, jobId: string) {
    let job = await this.requireJob(companyId, jobId);
    job = await this.refreshJobFromReceiptService(job);
    return this.toJobResponse(job);
  }

  async assertCompanyMember(
    companyId: string,
    userId: string,
  ): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
    const isMember = company.members?.some((m) => m.id === userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied to this company');
    }
    return company;
  }

  private async downloadInvoicePdf(
    companyId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const client = await this.getAuthedClient(companyId, {
      responseType: 'arraybuffer',
      accept: 'application/pdf',
    });

    const response = await client.get(
      `/api.xro/2.0/Invoices/${invoiceId}/pdf`,
    );

    return {
      buffer: Buffer.from(response.data),
      filename: `xero-invoice-${invoiceId}.pdf`,
      contentType: response.headers['content-type'] || 'application/pdf',
    };
  }

  private async refreshJobFromReceiptService(
    job: XeroInvoiceJob,
  ): Promise<XeroInvoiceJob> {
    if (!job.receiptId) {
      return job;
    }

    try {
      const status = await this.receiptsService.getReceiptStatus(
        job.receiptId,
        job.companyId,
        job.environment,
      );
      const details = await this.receiptsService
        .getReceiptById(job.receiptId, job.companyId, job.environment)
        .catch(() => null);

      job.processedPayload = {
        ...(job.processedPayload || {}),
        status,
        receipt: details,
      };

      const raw = String(
        status?.status ||
          status?.state ||
          status?.processingStatus ||
          details?.status ||
          details?.processingStatus ||
          '',
      ).toLowerCase();

      if (
        [
          'completed',
          'complete',
          'processed',
          'done',
          'success',
          'approved',
        ].includes(raw)
      ) {
        job.status = XeroInvoiceJobStatus.PROCESSED;
        job.error = null;
      } else if (['failed', 'error', 'rejected'].includes(raw)) {
        job.status = XeroInvoiceJobStatus.FAILED;
        job.error =
          status?.error ||
          status?.message ||
          details?.error ||
          'Receipt processing failed';
      } else if (
        job.status === XeroInvoiceJobStatus.SUBMITTED ||
        job.status === XeroInvoiceJobStatus.IMPORTED
      ) {
        job.status = XeroInvoiceJobStatus.PROCESSING;
      }

      return this.xeroInvoiceJobRepository.save(job);
    } catch (error: any) {
      this.logger.warn(
        `Could not refresh receipt status for Xero job ${job.id}: ${error.message}`,
      );
      return job;
    }
  }

  private toJobResponse(
    job: XeroInvoiceJob,
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: job.id,
      companyId: job.companyId,
      xeroInvoiceId: job.xeroInvoiceId,
      xeroInvoiceNumber: job.xeroInvoiceNumber,
      receiptId: job.receiptId,
      environment: job.environment,
      status: job.status,
      error: job.error,
      sourcePayload: job.sourcePayload,
      processedPayload: job.processedPayload,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...extra,
    };
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Xero is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
      );
    }
  }

  private async requireConnection(
    companyId: string,
    options: { requireTenant?: boolean } = {},
  ): Promise<XeroConnection> {
    const requireTenant = options.requireTenant !== false;
    const connection = await this.xeroConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!connection) {
      throw new BadRequestException(
        'Xero is not connected for this company. Start OAuth via GET /xero/:companyId/connect',
      );
    }
    if (requireTenant && !connection.tenantId) {
      throw new BadRequestException(
        'Xero tenant not set. Call GET /xero/:companyId/tenants then PUT /xero/:companyId/tenant',
      );
    }
    return connection;
  }

  private async requireJob(
    companyId: string,
    jobId: string,
  ): Promise<XeroInvoiceJob> {
    const job = await this.xeroInvoiceJobRepository.findOne({
      where: { id: jobId, companyId },
    });
    if (!job) {
      throw new NotFoundException(`Xero invoice job ${jobId} not found`);
    }
    return job;
  }

  private async fetchConnections(accessToken: string): Promise<any[]> {
    const { data } = await axios.get(this.getConnectionsUrl(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    return Array.isArray(data) ? data : [];
  }

  private async getAuthedClient(
    companyId: string,
    options: {
      requireTenant?: boolean;
      responseType?: 'json' | 'arraybuffer';
      accept?: string;
    } = {},
  ): Promise<AxiosInstance> {
    let connection = await this.requireConnection(companyId, options);
    connection = await this.refreshTokenIfNeeded(connection);

    const accessToken = EncryptionUtil.decrypt(connection.accessToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: options.accept || 'application/json',
    };
    if (connection.tenantId) {
      headers['xero-tenant-id'] = connection.tenantId;
    }
    if (!options.accept) {
      headers['Content-Type'] = 'application/json';
    }

    return axios.create({
      baseURL: connection.apiBaseUrl,
      headers,
      responseType: options.responseType || 'json',
    });
  }

  private async refreshTokenIfNeeded(
    connection: XeroConnection,
  ): Promise<XeroConnection> {
    const bufferMs = 60 * 1000;
    if (connection.expiresAt.getTime() - Date.now() > bufferMs) {
      return connection;
    }

    this.logger.log(`Refreshing Xero token for company ${connection.companyId}`);

    try {
      const refreshToken = EncryptionUtil.decrypt(connection.refreshToken);
      const { data } = await axios.post(
        this.getTokenUrl(),
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: {
            Authorization: this.getBasicAuthHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (!data.access_token) {
        throw new Error('No access_token in Xero refresh response');
      }

      connection.accessToken = EncryptionUtil.encrypt(data.access_token);
      connection.expiresAt = new Date(
        Date.now() + (data.expires_in || 1800) * 1000,
      );
      if (data.refresh_token) {
        connection.refreshToken = EncryptionUtil.encrypt(data.refresh_token);
      }

      return this.xeroConnectionRepository.save(connection);
    } catch (error: any) {
      this.logger.error(
        `Xero token refresh failed: ${JSON.stringify(error.response?.data) || error.message}`,
      );
      if (error.response?.data?.error === 'invalid_grant') {
        connection.isActive = false;
        connection.pollingEnabled = false;
        await this.xeroConnectionRepository.save(connection);
      }
      throw new ServiceUnavailableException(
        'Xero session expired. Reconnect via GET /xero/:companyId/connect',
      );
    }
  }

  private async logErpEvent(
    companyId: string,
    eventType: string,
    message: string,
    options: {
      level?: string;
      environment?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    await this.loggingService.safeCreateLog({
      companyId,
      environment: options.environment || 'test',
      eventType,
      message,
      level: options.level || 'info',
      metadata: { source: 'xero', ...(options.metadata || {}) },
    });
  }
}
