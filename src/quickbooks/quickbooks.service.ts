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
import { QuickBooksConnection } from './entities/quickbooks-connection.entity';
import {
  QuickBooksInvoiceJob,
  QuickBooksInvoiceJobStatus,
} from './entities/quickbooks-invoice-job.entity';
import { Company } from '../companies/entities/company.entity';
import { EncryptionUtil } from '../common/utils/encryption.util';
import { ReceiptsService } from '../receipts/receipts.service';
import { LoggingService } from '../logging/logging.service';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceSource } from '../invoices/entities/invoice.entity';
import { SyncQuickBooksInvoicesDto } from './dto/sync-invoices.dto';

@Injectable()
export class QuickBooksService {
  private readonly logger = new Logger(QuickBooksService.name);

  constructor(
    @InjectRepository(QuickBooksConnection)
    private quickBooksConnectionRepository: Repository<QuickBooksConnection>,
    @InjectRepository(QuickBooksInvoiceJob)
    private quickBooksInvoiceJobRepository: Repository<QuickBooksInvoiceJob>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private configService: ConfigService,
    private receiptsService: ReceiptsService,
    private loggingService: LoggingService,
    private invoicesService: InvoicesService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('QUICKBOOKS_CLIENT_ID') &&
        this.configService.get<string>('QUICKBOOKS_CLIENT_SECRET'),
    );
  }

  private getAuthUrl(): string {
    return (
      this.configService.get<string>('QUICKBOOKS_AUTH_URL') ||
      'https://appcenter.intuit.com/connect/oauth2'
    );
  }

  private getTokenUrl(): string {
    return (
      this.configService.get<string>('QUICKBOOKS_TOKEN_URL') ||
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
    );
  }

  private getRedirectUri(): string {
    return (
      this.configService.get<string>('QUICKBOOKS_REDIRECT_URI') ||
      'http://localhost:3000/api/quickbooks/callback'
    );
  }

  private getScopes(): string {
    return (
      this.configService.get<string>('QUICKBOOKS_SCOPES') ||
      'com.intuit.quickbooks.accounting'
    );
  }

  private getApiBaseUrl(): string {
    const useSandbox =
      this.configService.get<string>('QUICKBOOKS_USE_SANDBOX') === 'true';
    return (
      this.configService.get<string>('QUICKBOOKS_API_BASE_URL') ||
      (useSandbox
        ? 'https://sandbox-quickbooks.api.intuit.com'
        : 'https://quickbooks.api.intuit.com')
    );
  }

  private getBasicAuthHeader(): string {
    const clientId = this.configService.get<string>('QUICKBOOKS_CLIENT_ID')!;
    const clientSecret = this.configService.get<string>(
      'QUICKBOOKS_CLIENT_SECRET',
    )!;
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  getAuthorizationUrl(companyId: string): { url: string } {
    this.assertConfigured();

    const params = new URLSearchParams({
      client_id: this.configService.get<string>('QUICKBOOKS_CLIENT_ID')!,
      response_type: 'code',
      scope: this.getScopes(),
      redirect_uri: this.getRedirectUri(),
      state: companyId,
    });

    return { url: `${this.getAuthUrl()}?${params.toString()}` };
  }

  async handleOAuthCallback(
    code: string,
    companyId: string,
    realmId: string,
  ): Promise<QuickBooksConnection> {
    this.assertConfigured();

    if (!realmId) {
      throw new BadRequestException(
        'QuickBooks callback missing realmId (company id)',
      );
    }

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
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    if (!access_token || !refresh_token) {
      throw new BadRequestException(
        'QuickBooks did not return access/refresh tokens.',
      );
    }

    let connection = await this.quickBooksConnectionRepository.findOne({
      where: { companyId },
    });
    if (!connection) {
      connection = this.quickBooksConnectionRepository.create({ companyId });
    }

    connection.accessToken = EncryptionUtil.encrypt(access_token);
    connection.refreshToken = EncryptionUtil.encrypt(refresh_token);
    connection.expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);
    connection.realmId = String(realmId);
    connection.apiBaseUrl = this.getApiBaseUrl();
    connection.isActive = true;
    connection.pollingEnabled = true;
    connection.environment =
      this.configService.get<string>('QUICKBOOKS_DEFAULT_ENVIRONMENT') ||
      'test';

    const saved = await this.quickBooksConnectionRepository.save(connection);
    await this.logErpEvent(
      companyId,
      'quickbooks.connected',
      'QuickBooks connected',
      {
        environment: saved.environment || 'test',
        metadata: { realmId: saved.realmId },
      },
    );
    return saved;
  }

  async getConnectionStatus(companyId: string) {
    const connection = await this.quickBooksConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });

    if (!connection) {
      return {
        connected: false,
        configured: this.isConfigured(),
        message: this.isConfigured()
          ? 'Not connected. Start OAuth via GET /quickbooks/:companyId/connect'
          : 'QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
      };
    }

    return {
      connected: true,
      configured: true,
      realmId: connection.realmId,
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
    await this.quickBooksConnectionRepository.save(connection);
    await this.logErpEvent(
      companyId,
      'quickbooks.disconnected',
      'QuickBooks disconnected',
      { environment: connection.environment || 'test' },
    );
    return { message: 'QuickBooks disconnected' };
  }

  async updatePolling(
    companyId: string,
    pollingEnabled: boolean,
  ): Promise<{ pollingEnabled: boolean }> {
    const connection = await this.requireConnection(companyId);
    connection.pollingEnabled = pollingEnabled;
    await this.quickBooksConnectionRepository.save(connection);
    return { pollingEnabled: connection.pollingEnabled };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollAllConnectedCompanies() {
    const enabled =
      this.configService.get<string>('QUICKBOOKS_POLLING_ENABLED') !== 'false';
    if (!enabled) {
      return;
    }

    const connections = await this.quickBooksConnectionRepository.find({
      where: { isActive: true, pollingEnabled: true },
    });

    for (const connection of connections) {
      try {
        await this.syncInvoices(connection.companyId, {}, 'poll');
      } catch (error: any) {
        this.logger.error(
          `QuickBooks poll failed for company ${connection.companyId}: ${error.message}`,
        );
        await this.logErpEvent(
          connection.companyId,
          'quickbooks.sync.failed',
          `QuickBooks poll failed: ${error.message}`,
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
   * Poll Invoice entities updated since lastSyncedAt via QBO query language.
   */
  async syncInvoices(
    companyId: string,
    dto: SyncQuickBooksInvoicesDto = {},
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

    // QBO query datetime: 2015-01-01T00:00:00-00:00 style without millis
    const sinceParam = this.formatQboDateTime(sinceDate);
    const invoices: any[] = [];
    let startPosition = 1;
    const maxResults = 50;

    while (startPosition <= 500) {
      const query = `SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '${sinceParam}' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
      const { data } = await client.get('/query', {
        params: { query, minorversion: 75 },
      });

      const batch = data?.QueryResponse?.Invoice || [];
      const list = Array.isArray(batch) ? batch : batch ? [batch] : [];
      invoices.push(...list);

      if (list.length < maxResults) {
        break;
      }
      startPosition += maxResults;
    }

    const imported: Array<Record<string, unknown>> = [];
    const skipped: string[] = [];

    for (const invoice of invoices) {
      const invoiceId = String(invoice.Id || '');
      if (!invoiceId) {
        continue;
      }

      const existing = await this.quickBooksInvoiceJobRepository.find({
        where: { companyId, quickbooksInvoiceId: invoiceId },
        order: { createdAt: 'DESC' },
        take: 1,
      });
      const job = existing[0];
      if (job && job.status !== QuickBooksInvoiceJobStatus.FAILED) {
        skipped.push(invoiceId);
        continue;
      }

      const result = await this.importAndProcessInvoice(
        companyId,
        invoiceId,
        {
          submitForProcessing: dto.submitForProcessing !== false,
          invoiceSnapshot: invoice,
        },
      );
      imported.push(result);
    }

    connection.lastSyncedAt = new Date();
    await this.quickBooksConnectionRepository.save(connection);

    const result = {
      since: sinceParam,
      fetched: invoices.length,
      imported: imported.length,
      skipped: skipped.length,
      lastSyncedAt: connection.lastSyncedAt,
      jobs: imported,
    };
    await this.logErpEvent(
      companyId,
      'quickbooks.sync.completed',
      'QuickBooks invoice sync completed',
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
          'quickbooks.sync.failed',
          `QuickBooks invoice sync failed: ${error.message}`,
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

  async listInvoices(companyId: string, maxResults = 25) {
    const client = await this.getAuthedClient(companyId);
    const query = `SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS ${Math.min(maxResults, 100)}`;
    const { data } = await client.get('/query', {
      params: { query, minorversion: 75 },
    });
    const invoices = data?.QueryResponse?.Invoice || [];
    return {
      invoices: Array.isArray(invoices) ? invoices : invoices ? [invoices] : [],
    };
  }

  async getInvoice(companyId: string, invoiceId: string) {
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get(`/invoice/${invoiceId}`, {
      params: { minorversion: 75 },
    });
    return data?.Invoice || data;
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
        `Could not download QuickBooks invoice PDF ${invoiceId}: ${error.message}`,
      );
    }

    const existingJobs = await this.quickBooksInvoiceJobRepository.find({
      where: { companyId, quickbooksInvoiceId: String(invoiceId) },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let job =
      existingJobs[0] ||
      this.quickBooksInvoiceJobRepository.create({
        companyId,
        quickbooksInvoiceId: String(invoiceId),
      });

    job.quickbooksInvoiceNumber =
      invoice.DocNumber || invoice.docNumber || job.quickbooksInvoiceNumber;
    job.environment = connection.environment || 'test';
    job.sourcePayload = {
      ...invoice,
      _source: 'quickbooks_poll',
    };
    job.status = QuickBooksInvoiceJobStatus.IMPORTED;
    job.error = null;
    job = await this.quickBooksInvoiceJobRepository.save(job);

    await this.invoicesService.upsertFromErp({
      companyId,
      environment: job.environment,
      source: InvoiceSource.QUICKBOOKS,
      externalId: String(invoiceId),
      payload: invoice,
    });

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
          `quickbooks-invoice-${job.quickbooksInvoiceNumber || invoiceId}.pdf`,
        contentType: pdf?.contentType || 'application/pdf',
        metadata: {
          source: 'quickbooks',
          quickbooksInvoiceId: job.quickbooksInvoiceId,
          quickbooksInvoiceNumber: job.quickbooksInvoiceNumber,
          invoice,
          jobId: job.id,
        },
      });

      job.receiptId =
        submitted?.id ||
        submitted?.receiptId ||
        submitted?.receipt?.id ||
        job.receiptId;
      job.status = QuickBooksInvoiceJobStatus.SUBMITTED;
      job.processedPayload = submitted as Record<string, unknown>;
      job = await this.quickBooksInvoiceJobRepository.save(job);
      job = await this.refreshJobFromReceiptService(job);
    } catch (error: any) {
      const message =
        error instanceof HttpException
          ? JSON.stringify(error.getResponse())
          : error.message;
      job.status = QuickBooksInvoiceJobStatus.FAILED;
      job.error = `Receipt service submit failed: ${message}`;
      job = await this.quickBooksInvoiceJobRepository.save(job);
      this.logger.error(
        `QuickBooks invoice submit failed for ${invoiceId}: ${message}`,
      );
    }

    return this.toJobResponse(job, { pdfDownloaded: Boolean(pdf) });
  }

  async listJobs(companyId: string, page = 1, perPage = 25) {
    const [items, total] = await this.quickBooksInvoiceJobRepository.findAndCount(
      {
        where: { companyId },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * perPage,
        take: perPage,
      },
    );

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

    const response = await client.get(`/invoice/${invoiceId}/pdf`, {
      params: { minorversion: 75 },
    });

    return {
      buffer: Buffer.from(response.data),
      filename: `quickbooks-invoice-${invoiceId}.pdf`,
      contentType: response.headers['content-type'] || 'application/pdf',
    };
  }

  private async refreshJobFromReceiptService(
    job: QuickBooksInvoiceJob,
  ): Promise<QuickBooksInvoiceJob> {
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
        job.status = QuickBooksInvoiceJobStatus.PROCESSED;
        job.error = null;
      } else if (['failed', 'error', 'rejected'].includes(raw)) {
        job.status = QuickBooksInvoiceJobStatus.FAILED;
        job.error =
          status?.error ||
          status?.message ||
          details?.error ||
          'Receipt processing failed';
      } else if (
        job.status === QuickBooksInvoiceJobStatus.SUBMITTED ||
        job.status === QuickBooksInvoiceJobStatus.IMPORTED
      ) {
        job.status = QuickBooksInvoiceJobStatus.PROCESSING;
      }

      return this.quickBooksInvoiceJobRepository.save(job);
    } catch (error: any) {
      this.logger.warn(
        `Could not refresh receipt status for QuickBooks job ${job.id}: ${error.message}`,
      );
      return job;
    }
  }

  private toJobResponse(
    job: QuickBooksInvoiceJob,
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: job.id,
      companyId: job.companyId,
      quickbooksInvoiceId: job.quickbooksInvoiceId,
      quickbooksInvoiceNumber: job.quickbooksInvoiceNumber,
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

  private formatQboDateTime(date: Date): string {
    // QBO prefers ISO without milliseconds, e.g. 2024-01-15T10:30:00-00:00
    return date.toISOString().replace(/\.\d{3}Z$/, '-00:00');
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
      );
    }
  }

  private async requireConnection(
    companyId: string,
  ): Promise<QuickBooksConnection> {
    const connection = await this.quickBooksConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!connection) {
      throw new BadRequestException(
        'QuickBooks is not connected for this company. Start OAuth via GET /quickbooks/:companyId/connect',
      );
    }
    if (!connection.realmId) {
      throw new BadRequestException(
        'QuickBooks realmId missing. Reconnect via GET /quickbooks/:companyId/connect',
      );
    }
    return connection;
  }

  private async requireJob(
    companyId: string,
    jobId: string,
  ): Promise<QuickBooksInvoiceJob> {
    const job = await this.quickBooksInvoiceJobRepository.findOne({
      where: { id: jobId, companyId },
    });
    if (!job) {
      throw new NotFoundException(`QuickBooks invoice job ${jobId} not found`);
    }
    return job;
  }

  private async getAuthedClient(
    companyId: string,
    options?: { responseType?: 'json' | 'arraybuffer'; accept?: string },
  ): Promise<AxiosInstance> {
    let connection = await this.requireConnection(companyId);
    connection = await this.refreshTokenIfNeeded(connection);

    const accessToken = EncryptionUtil.decrypt(connection.accessToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: options?.accept || 'application/json',
    };
    if (!options?.accept) {
      headers['Content-Type'] = 'application/json';
    }

    return axios.create({
      baseURL: `${connection.apiBaseUrl}/v3/company/${connection.realmId}`,
      headers,
      responseType: options?.responseType || 'json',
    });
  }

  private async refreshTokenIfNeeded(
    connection: QuickBooksConnection,
  ): Promise<QuickBooksConnection> {
    const bufferMs = 5 * 60 * 1000;
    if (connection.expiresAt.getTime() - Date.now() > bufferMs) {
      return connection;
    }

    this.logger.log(
      `Refreshing QuickBooks token for company ${connection.companyId}`,
    );

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
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (!data.access_token) {
        throw new Error('No access_token in QuickBooks refresh response');
      }

      connection.accessToken = EncryptionUtil.encrypt(data.access_token);
      connection.expiresAt = new Date(
        Date.now() + (data.expires_in || 3600) * 1000,
      );
      // QBO rotates refresh tokens — always persist the latest
      if (data.refresh_token) {
        connection.refreshToken = EncryptionUtil.encrypt(data.refresh_token);
      }

      return this.quickBooksConnectionRepository.save(connection);
    } catch (error: any) {
      this.logger.error(
        `QuickBooks token refresh failed: ${JSON.stringify(error.response?.data) || error.message}`,
      );

      if (error.response?.data?.error === 'invalid_grant') {
        connection.isActive = false;
        connection.pollingEnabled = false;
        await this.quickBooksConnectionRepository.save(connection);
      }

      throw new ServiceUnavailableException(
        'QuickBooks session expired. Reconnect via GET /quickbooks/:companyId/connect',
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
      metadata: { source: 'quickbooks', ...(options.metadata || {}) },
    });
  }
}
