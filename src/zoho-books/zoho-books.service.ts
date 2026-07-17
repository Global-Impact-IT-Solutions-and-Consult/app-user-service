import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import * as crypto from 'crypto';
import { ZohoConnection } from './entities/zoho-connection.entity';
import {
  ZohoInvoiceJob,
  ZohoInvoiceJobStatus,
} from './entities/zoho-invoice-job.entity';
import {
  ZohoWebhookEndpoint,
  ZohoWebhookStatus,
} from './entities/zoho-webhook-endpoint.entity';
import { Company } from '../companies/entities/company.entity';
import { EncryptionUtil } from '../common/utils/encryption.util';
import { ApiKeyGeneratorUtil } from '../common/utils/api-key-generator.util';
import { CreateInvoiceDto, SyncContactDto } from './dto/create-invoice.dto';
import {
  ImportInvoiceDto,
  WriteBackInvoiceDto,
} from './dto/import-invoice.dto';
import { CreateZohoWebhookDto } from './dto/zoho-webhook.dto';
import { ReceiptsService } from '../receipts/receipts.service';

@Injectable()
export class ZohoBooksService {
  private readonly logger = new Logger(ZohoBooksService.name);

  constructor(
    @InjectRepository(ZohoConnection)
    private zohoConnectionRepository: Repository<ZohoConnection>,
    @InjectRepository(ZohoInvoiceJob)
    private zohoInvoiceJobRepository: Repository<ZohoInvoiceJob>,
    @InjectRepository(ZohoWebhookEndpoint)
    private zohoWebhookEndpointRepository: Repository<ZohoWebhookEndpoint>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private configService: ConfigService,
    private receiptsService: ReceiptsService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('ZOHO_CLIENT_ID') &&
        this.configService.get<string>('ZOHO_CLIENT_SECRET'),
    );
  }

  private getAccountsDomain(): string {
    return (
      this.configService.get<string>('ZOHO_ACCOUNTS_URL') ||
      'https://accounts.zoho.com'
    );
  }

  private getRedirectUri(): string {
    return (
      this.configService.get<string>('ZOHO_REDIRECT_URI') ||
      'http://localhost:3000/api/zoho-books/callback'
    );
  }

  private getScopes(): string {
    return (
      this.configService.get<string>('ZOHO_SCOPES') ||
      [
        'ZohoBooks.contacts.ALL',
        'ZohoBooks.invoices.ALL',
        'ZohoBooks.settings.READ',
      ].join(',')
    );
  }

  /**
   * Build the Zoho OAuth authorization URL for a company.
   * `state` carries companyId so the callback can associate the connection.
   */
  getAuthorizationUrl(companyId: string): { url: string } {
    this.assertConfigured();

    const clientId = this.configService.get<string>('ZOHO_CLIENT_ID');
    const params = new URLSearchParams({
      scope: this.getScopes(),
      client_id: clientId!,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      redirect_uri: this.getRedirectUri(),
      state: companyId,
    });

    return {
      url: `${this.getAccountsDomain()}/oauth/v2/auth?${params.toString()}`,
    };
  }

  async handleOAuthCallback(
    code: string,
    companyId: string,
    accountsServer?: string,
  ): Promise<ZohoConnection> {
    this.assertConfigured();

    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const accountsDomain = accountsServer || this.getAccountsDomain();
    const tokenResponse = await axios.post(
      `${accountsDomain}/oauth/v2/token`,
      null,
      {
        params: {
          grant_type: 'authorization_code',
          client_id: this.configService.get<string>('ZOHO_CLIENT_ID'),
          client_secret: this.configService.get<string>('ZOHO_CLIENT_SECRET'),
          redirect_uri: this.getRedirectUri(),
          code,
        },
      },
    );

    const {
      access_token,
      refresh_token,
      expires_in,
      api_domain,
    } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      throw new BadRequestException(
        'Zoho did not return access/refresh tokens. Ensure access_type=offline and prompt=consent.',
      );
    }

    const apiDomain = api_domain || 'https://www.zohoapis.com';
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    let connection = await this.zohoConnectionRepository.findOne({
      where: { companyId },
    });

    if (!connection) {
      connection = this.zohoConnectionRepository.create({ companyId });
    }

    connection.accessToken = EncryptionUtil.encrypt(access_token);
    connection.refreshToken = EncryptionUtil.encrypt(refresh_token);
    connection.expiresAt = expiresAt;
    connection.apiDomain = apiDomain;
    connection.accountsDomain = accountsDomain;
    connection.isActive = true;

    // Pick organization: env override or first org from Zoho
    const configuredOrgId = this.configService.get<string>(
      'ZOHO_ORGANIZATION_ID',
    );
    if (configuredOrgId) {
      connection.organizationId = configuredOrgId;
    } else {
      const orgs = await this.fetchOrganizations(
        access_token,
        apiDomain,
      );
      if (!orgs.length) {
        throw new BadRequestException(
          'No Zoho Books organizations found for this account',
        );
      }
      connection.organizationId = String(orgs[0].organization_id);
    }

    return this.zohoConnectionRepository.save(connection);
  }

  async getConnectionStatus(companyId: string) {
    const connection = await this.zohoConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });
    const webhook = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId, isActive: true },
    });

    return {
      oauth: connection
        ? {
            connected: true,
            organizationId: connection.organizationId,
            zohoContactId: connection.zohoContactId,
            apiDomain: connection.apiDomain,
            expiresAt: connection.expiresAt,
            connectedAt: connection.createdAt,
          }
        : { connected: false },
      webhook: webhook
        ? this.toWebhookStatusResponse(webhook)
        : { configured: false, status: 'not_configured' },
    };
  }

  /**
   * Create (or return existing) unique Zoho webhook URL for a company.
   * Signing secret is only returned when newly created or rotated.
   */
  async createOrGetWebhookEndpoint(
    companyId: string,
    dto: CreateZohoWebhookDto = {},
  ) {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    let endpoint = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId },
    });

    if (endpoint && endpoint.isActive) {
      return {
        ...this.toWebhookStatusResponse(endpoint),
        signingSecret: null,
        signingSecretNote:
          'Secret was already issued. Rotate the webhook to get a new secret.',
        setupInstructions: this.buildWebhookSetupInstructions(endpoint),
      };
    }

    const webhookToken = this.generateWebhookToken();
    const signingSecret = ApiKeyGeneratorUtil.generateWebhookSecret();

    if (!endpoint) {
      endpoint = this.zohoWebhookEndpointRepository.create({ companyId });
    }

    endpoint.webhookToken = webhookToken;
    endpoint.signingSecretEncrypted = EncryptionUtil.encrypt(signingSecret);
    endpoint.status = ZohoWebhookStatus.PENDING;
    endpoint.isActive = true;
    endpoint.environment = dto.environment || 'test';
    endpoint.lastReceivedAt = null;
    endpoint.lastEventType = null;
    endpoint.receiveCount = 0;
    endpoint.lastPayload = null;

    endpoint = await this.zohoWebhookEndpointRepository.save(endpoint);

    return {
      ...this.toWebhookStatusResponse(endpoint),
      signingSecret,
      signingSecretNote:
        'Copy this secret now. It will not be shown again. Add it in Zoho as the webhook secret token and/or custom header X-Zoho-Webhook-Token.',
      setupInstructions: this.buildWebhookSetupInstructions(endpoint),
    };
  }

  async getWebhookEndpointStatus(companyId: string) {
    const endpoint = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!endpoint) {
      return {
        configured: false,
        status: 'not_configured',
        message:
          'No webhook configured. Call POST /zoho-books/:companyId/webhook to create one.',
      };
    }
    return {
      ...this.toWebhookStatusResponse(endpoint),
      setupInstructions: this.buildWebhookSetupInstructions(endpoint),
    };
  }

  async rotateWebhookEndpoint(
    companyId: string,
    dto: CreateZohoWebhookDto = {},
  ) {
    const existing = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId },
    });
    if (!existing) {
      return this.createOrGetWebhookEndpoint(companyId, dto);
    }

    const webhookToken = this.generateWebhookToken();
    const signingSecret = ApiKeyGeneratorUtil.generateWebhookSecret();

    existing.webhookToken = webhookToken;
    existing.signingSecretEncrypted = EncryptionUtil.encrypt(signingSecret);
    existing.status = ZohoWebhookStatus.PENDING;
    existing.isActive = true;
    existing.environment = dto.environment || existing.environment || 'test';
    existing.lastReceivedAt = null;
    existing.lastEventType = null;
    existing.receiveCount = 0;
    existing.lastPayload = null;

    const endpoint = await this.zohoWebhookEndpointRepository.save(existing);

    return {
      ...this.toWebhookStatusResponse(endpoint),
      signingSecret,
      signingSecretNote:
        'Webhook URL and secret rotated. Update the URL/secret in Zoho Books.',
      setupInstructions: this.buildWebhookSetupInstructions(endpoint),
    };
  }

  async disableWebhookEndpoint(companyId: string) {
    const endpoint = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!endpoint) {
      throw new NotFoundException('No active Zoho webhook for this company');
    }
    endpoint.isActive = false;
    endpoint.status = ZohoWebhookStatus.DISABLED;
    await this.zohoWebhookEndpointRepository.save(endpoint);
    return { message: 'Zoho webhook disabled', companyId };
  }

  /**
   * Public inbound endpoint hit by Zoho Books (or our test simulator).
   */
  async handleInboundWebhook(
    webhookToken: string,
    payload: any,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: string | Buffer,
    options: { isTest?: boolean } = {},
  ) {
    const endpoint = await this.zohoWebhookEndpointRepository.findOne({
      where: { webhookToken, isActive: true },
    });
    if (!endpoint) {
      throw new NotFoundException('Unknown or inactive webhook URL');
    }

    this.verifyWebhookAuth(endpoint, headers, rawBody);

    const eventType = options.isTest
      ? 'connection.test'
      : this.extractEventType(payload);

    endpoint.lastReceivedAt = new Date();
    endpoint.lastEventType = eventType;
    endpoint.receiveCount = (endpoint.receiveCount || 0) + 1;
    endpoint.lastPayload = this.truncatePayload(payload);
    endpoint.status = ZohoWebhookStatus.CONNECTED;
    await this.zohoWebhookEndpointRepository.save(endpoint);

    if (options.isTest || eventType === 'connection.test') {
      return {
        ok: true,
        connected: true,
        companyId: endpoint.companyId,
        status: endpoint.status,
        eventType,
        message:
          'Webhook connection confirmed. Zoho can now send invoice events to this URL.',
      };
    }

    const invoice = this.extractInvoiceFromPayload(payload);
    let job: ZohoInvoiceJob | null = null;

    if (invoice?.invoiceId || invoice?.invoiceNumber || invoice?.raw) {
      job = await this.createJobFromWebhookPayload(
        endpoint,
        invoice,
        payload,
      );
    }

    return {
      ok: true,
      connected: true,
      companyId: endpoint.companyId,
      status: endpoint.status,
      eventType,
      job: job ? this.toJobResponse(job) : null,
      message: job
        ? 'Invoice webhook received and queued for processing'
        : 'Webhook received and connection confirmed (no invoice fields found to process)',
    };
  }

  /**
   * Authenticated helper: simulate Zoho hitting this company's webhook
   * so you can confirm the link works before/without Zoho's UI test.
   */
  async simulateWebhook(companyId: string) {
    const endpoint = await this.zohoWebhookEndpointRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!endpoint) {
      throw new NotFoundException(
        'No active webhook. Create one with POST /zoho-books/:companyId/webhook',
      );
    }

    const secret = EncryptionUtil.decrypt(endpoint.signingSecretEncrypted);
    return this.handleInboundWebhook(
      endpoint.webhookToken,
      {
        event_type: 'connection.test',
        source: 'ibookam_simulate',
        companyId,
        testedAt: new Date().toISOString(),
      },
      { 'x-zoho-webhook-token': secret },
      undefined,
      { isTest: true },
    );
  }

  async disconnect(companyId: string): Promise<{ message: string }> {
    const connection = await this.requireConnection(companyId);
    connection.isActive = false;
    await this.zohoConnectionRepository.save(connection);
    return { message: 'Zoho Books disconnected' };
  }

  async listOrganizations(companyId: string) {
    const client = await this.getAuthedClient(companyId);
    const connection = await this.requireConnection(companyId);
    const { data } = await client.get('/books/v3/organizations');
    return {
      currentOrganizationId: connection.organizationId,
      organizations: data.organizations || [],
    };
  }

  async setOrganization(companyId: string, organizationId: string) {
    const connection = await this.requireConnection(companyId);
    connection.organizationId = organizationId;
    await this.zohoConnectionRepository.save(connection);
    return { organizationId };
  }

  async syncCompanyAsContact(
    companyId: string,
    dto: SyncContactDto = {},
  ) {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId);
    const email =
      dto.email || company.members?.[0]?.email || undefined;

    const payload: Record<string, unknown> = {
      contact_name: company.name,
      company_name: company.legalName || company.name,
      contact_type: 'customer',
      ...(company.taxId ? { tax_reg_no: company.taxId } : {}),
      ...(email ? { email } : {}),
      ...(dto.phone ? { phone: dto.phone } : {}),
    };

    let response;
    if (connection.zohoContactId) {
      response = await client.put(
        `/books/v3/contacts/${connection.zohoContactId}`,
        payload,
        { params: { organization_id: connection.organizationId } },
      );
    } else {
      response = await client.post('/books/v3/contacts', payload, {
        params: { organization_id: connection.organizationId },
      });
    }

    const contact = response.data.contact;
    connection.zohoContactId = String(contact.contact_id);
    await this.zohoConnectionRepository.save(connection);

    return {
      zohoContactId: connection.zohoContactId,
      contact,
    };
  }

  async listContacts(companyId: string, page = 1, perPage = 25) {
    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get('/books/v3/contacts', {
      params: {
        organization_id: connection.organizationId,
        page,
        per_page: perPage,
      },
    });
    return data;
  }

  async createInvoice(companyId: string, dto: CreateInvoiceDto) {
    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId);

    const customerId = dto.customerId || connection.zohoContactId;
    if (!customerId) {
      throw new BadRequestException(
        'No Zoho customer ID. Sync the company as a contact first, or pass customerId.',
      );
    }

    const payload = {
      customer_id: customerId,
      date: dto.date,
      due_date: dto.dueDate,
      notes: dto.notes,
      line_items: dto.lineItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        rate: item.rate,
        ...(item.itemId ? { item_id: item.itemId } : {}),
      })),
    };

    const { data } = await client.post('/books/v3/invoices', payload, {
      params: { organization_id: connection.organizationId },
    });

    const invoice = data.invoice;

    if (dto.send && invoice?.invoice_id) {
      await client.post(
        `/books/v3/invoices/${invoice.invoice_id}/status/sent`,
        {},
        { params: { organization_id: connection.organizationId } },
      );
    }

    return invoice;
  }

  async listInvoices(companyId: string, page = 1, perPage = 25) {
    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get('/books/v3/invoices', {
      params: {
        organization_id: connection.organizationId,
        page,
        per_page: perPage,
      },
    });
    return data;
  }

  async getInvoice(companyId: string, invoiceId: string) {
    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId);
    const { data } = await client.get(`/books/v3/invoices/${invoiceId}`, {
      params: { organization_id: connection.organizationId },
    });
    return data.invoice;
  }

  /**
   * Round-trip step 1–2: pull invoice (+ PDF) from Zoho, optionally submit to receipt service.
   */
  async importAndProcessInvoice(
    companyId: string,
    invoiceId: string,
    environment: string,
    dto: ImportInvoiceDto = {},
  ) {
    const invoice = await this.getInvoice(companyId, invoiceId);
    const env = dto.environment || environment || 'test';

    let pdf: { buffer: Buffer; filename: string; contentType: string } | null =
      null;
    try {
      pdf = await this.downloadInvoicePdf(companyId, invoiceId);
    } catch (error: any) {
      this.logger.warn(
        `Could not download Zoho invoice PDF ${invoiceId}: ${error.message}`,
      );
    }

    const existingJobs = await this.zohoInvoiceJobRepository.find({
      where: { companyId, zohoInvoiceId: String(invoiceId) },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    let job =
      existingJobs[0] ||
      this.zohoInvoiceJobRepository.create({
        companyId,
        zohoInvoiceId: String(invoiceId),
      });

    job.zohoInvoiceNumber =
      invoice.invoice_number || invoice.number || job.zohoInvoiceNumber;
    job.environment = env;
    job.sourcePayload = invoice as Record<string, unknown>;
    job.status = ZohoInvoiceJobStatus.IMPORTED;
    job.error = null;
    job = await this.zohoInvoiceJobRepository.save(job);

    const shouldSubmit = dto.submitForProcessing !== false;

    if (shouldSubmit) {
      try {
        const submitted = await this.receiptsService.submitForProcessing({
          companyId,
          environment: env,
          file: pdf?.buffer,
          filename:
            pdf?.filename ||
            `zoho-invoice-${invoice.invoice_number || invoiceId}.pdf`,
          contentType: pdf?.contentType || 'application/pdf',
          metadata: {
            source: 'zoho_books',
            zohoInvoiceId: String(invoiceId),
            zohoInvoiceNumber: invoice.invoice_number,
            customerName: invoice.customer_name,
            total: invoice.total,
            currency: invoice.currency_code,
            invoice,
            jobId: job.id,
          },
        });

        job.receiptId =
          submitted?.id ||
          submitted?.receiptId ||
          submitted?.receipt?.id ||
          job.receiptId;
        job.status = ZohoInvoiceJobStatus.SUBMITTED;
        job.processedPayload = submitted as Record<string, unknown>;
        job = await this.zohoInvoiceJobRepository.save(job);

        // Best-effort status refresh
        job = await this.refreshJobFromReceiptService(job);
      } catch (error: any) {
        const message =
          error instanceof HttpException
            ? JSON.stringify(error.getResponse())
            : error.message;
        job.status = ZohoInvoiceJobStatus.FAILED;
        job.error = `Receipt service submit failed: ${message}`;
        job = await this.zohoInvoiceJobRepository.save(job);
        this.logger.error(
          `Zoho import submit failed for invoice ${invoiceId}: ${message}`,
        );
      }
    }

    if (dto.writeBackIfReady && this.isProcessingComplete(job)) {
      return this.writeBackJob(job, {});
    }

    return this.toJobResponse(job, {
      pdfDownloaded: Boolean(pdf),
    });
  }

  /**
   * Poll receipt service and, when ready, write results back to Zoho.
   */
  async syncJob(
    companyId: string,
    jobId: string,
    dto: WriteBackInvoiceDto = {},
  ) {
    let job = await this.requireJob(companyId, jobId);
    job = await this.refreshJobFromReceiptService(job);

    if (this.isProcessingComplete(job)) {
      return this.writeBackJob(job, dto);
    }

    return this.toJobResponse(job);
  }

  async writeBackByJobId(
    companyId: string,
    jobId: string,
    dto: WriteBackInvoiceDto = {},
  ) {
    let job = await this.requireJob(companyId, jobId);
    job = await this.refreshJobFromReceiptService(job);
    return this.writeBackJob(job, dto);
  }

  async listJobs(companyId: string, page = 1, perPage = 25) {
    const [items, total] = await this.zohoInvoiceJobRepository.findAndCount({
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
    const connection = await this.requireConnection(companyId);
    const client = await this.getAuthedClient(companyId, {
      responseType: 'arraybuffer',
      accept: 'application/pdf',
    });

    const response = await client.get(`/books/v3/invoices/${invoiceId}`, {
      params: {
        organization_id: connection.organizationId,
        accept: 'pdf',
      },
    });

    const disposition = String(
      response.headers['content-disposition'] || '',
    );
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `zoho-invoice-${invoiceId}.pdf`;

    return {
      buffer: Buffer.from(response.data),
      filename,
      contentType: response.headers['content-type'] || 'application/pdf',
    };
  }

  private async refreshJobFromReceiptService(
    job: ZohoInvoiceJob,
  ): Promise<ZohoInvoiceJob> {
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

      const normalized = this.normalizeProcessingStatus(status, details);
      if (normalized === 'completed') {
        job.status = ZohoInvoiceJobStatus.PROCESSED;
        job.error = null;
      } else if (normalized === 'failed') {
        job.status = ZohoInvoiceJobStatus.FAILED;
        job.error =
          status?.error ||
          status?.message ||
          details?.error ||
          'Receipt processing failed';
      } else if (
        job.status === ZohoInvoiceJobStatus.SUBMITTED ||
        job.status === ZohoInvoiceJobStatus.IMPORTED
      ) {
        job.status = ZohoInvoiceJobStatus.PROCESSING;
      }

      return this.zohoInvoiceJobRepository.save(job);
    } catch (error: any) {
      this.logger.warn(
        `Could not refresh receipt status for job ${job.id}: ${error.message}`,
      );
      return job;
    }
  }

  private normalizeProcessingStatus(
    status: any,
    details: any,
  ): 'completed' | 'failed' | 'processing' {
    const raw = String(
      status?.status ||
        status?.state ||
        status?.processingStatus ||
        details?.status ||
        details?.processingStatus ||
        '',
    ).toLowerCase();

    if (
      ['completed', 'complete', 'processed', 'done', 'success', 'approved'].includes(
        raw,
      )
    ) {
      return 'completed';
    }
    if (['failed', 'error', 'rejected'].includes(raw)) {
      return 'failed';
    }
    if (status?.completed === true || details?.completed === true) {
      return 'completed';
    }
    return 'processing';
  }

  private isProcessingComplete(job: ZohoInvoiceJob): boolean {
    return (
      job.status === ZohoInvoiceJobStatus.PROCESSED ||
      job.status === ZohoInvoiceJobStatus.WRITEBACK_PENDING ||
      (Boolean(job.receiptId) &&
        Boolean(job.processedPayload) &&
        this.normalizeProcessingStatus(
          (job.processedPayload as any)?.status,
          (job.processedPayload as any)?.receipt,
        ) === 'completed')
    );
  }

  private async writeBackJob(
    job: ZohoInvoiceJob,
    dto: WriteBackInvoiceDto,
  ) {
    if (job.status === ZohoInvoiceJobStatus.FAILED && !job.processedPayload) {
      throw new BadRequestException(
        'Cannot write back a failed job with no processing result. Re-import or sync first.',
      );
    }

    job.status = ZohoInvoiceJobStatus.WRITEBACK_PENDING;
    job = await this.zohoInvoiceJobRepository.save(job);

    const connection = await this.requireConnection(job.companyId);
    const client = await this.getAuthedClient(job.companyId);
    const invoiceId = job.zohoInvoiceId;
    const summary = this.buildProcessingSummary(job, dto.notes);

    try {
      // Update invoice notes with processing summary
      const existingNotes = String(
        (job.sourcePayload as any)?.notes || '',
      ).trim();
      const notes = [existingNotes, summary].filter(Boolean).join('\n\n');

      await client.put(
        `/books/v3/invoices/${invoiceId}`,
        { notes },
        { params: { organization_id: connection.organizationId } },
      );

      if (dto.addComment !== false) {
        await client.post(
          `/books/v3/invoices/${invoiceId}/comments`,
          {
            description: summary,
            show_comment_to_clients: false,
          },
          { params: { organization_id: connection.organizationId } },
        );
      }

      if (dto.attachProcessedFile !== false && job.receiptId) {
        try {
          const downloaded = await this.receiptsService.downloadReceipt(
            job.receiptId,
            job.companyId,
            job.environment,
            'pdf',
          );
          await this.attachFileToInvoice(
            job.companyId,
            invoiceId,
            Buffer.from(downloaded.data),
            downloaded.filename || `processed-${job.receiptId}.pdf`,
            downloaded.contentType || 'application/pdf',
          );
        } catch (error: any) {
          this.logger.warn(
            `Write-back attachment skipped for job ${job.id}: ${error.message}`,
          );
        }
      }

      job.status = ZohoInvoiceJobStatus.COMPLETED;
      job.writeBackAt = new Date();
      job.error = null;
      job = await this.zohoInvoiceJobRepository.save(job);

      return this.toJobResponse(job, { writeBack: { notes: summary } });
    } catch (error: any) {
      const message =
        error.response?.data?.message ||
        error.message ||
        'Zoho write-back failed';
      job.status = ZohoInvoiceJobStatus.FAILED;
      job.error = `Write-back failed: ${message}`;
      job = await this.zohoInvoiceJobRepository.save(job);
      throw new BadRequestException(job.error);
    }
  }

  private buildProcessingSummary(
    job: ZohoInvoiceJob,
    notesOverride?: string,
  ): string {
    if (notesOverride) {
      return notesOverride;
    }

    const receipt = (job.processedPayload as any)?.receipt;
    const status = (job.processedPayload as any)?.status;
    const lines = [
      `[iBookam] Processed Zoho invoice ${job.zohoInvoiceNumber || job.zohoInvoiceId}`,
      `Job: ${job.id}`,
      job.receiptId ? `Receipt ID: ${job.receiptId}` : null,
      status?.status || status?.state
        ? `Status: ${status.status || status.state}`
        : `Status: ${job.status}`,
      receipt?.total != null ? `Extracted total: ${receipt.total}` : null,
      receipt?.vendor || receipt?.merchant
        ? `Vendor: ${receipt.vendor || receipt.merchant}`
        : null,
      `Synced at: ${new Date().toISOString()}`,
    ].filter(Boolean);

    return lines.join('\n');
  }

  private async attachFileToInvoice(
    companyId: string,
    invoiceId: string,
    file: Buffer,
    filename: string,
    contentType: string,
  ) {
    const connection = await this.requireConnection(companyId);
    let refreshed = await this.requireConnection(companyId);
    refreshed = await this.refreshTokenIfNeeded(refreshed);
    const accessToken = EncryptionUtil.decrypt(refreshed.accessToken);

    const form = new FormData();
    form.append('attachment', file, { filename, contentType });

    await axios.post(
      `${refreshed.apiDomain}/books/v3/invoices/${invoiceId}/attachment`,
      form,
      {
        params: { organization_id: connection.organizationId },
        headers: {
          ...form.getHeaders(),
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
  }

  private async requireJob(
    companyId: string,
    jobId: string,
  ): Promise<ZohoInvoiceJob> {
    const job = await this.zohoInvoiceJobRepository.findOne({
      where: { id: jobId, companyId },
    });
    if (!job) {
      throw new NotFoundException(`Zoho invoice job ${jobId} not found`);
    }
    return job;
  }

  private toJobResponse(job: ZohoInvoiceJob, extra: Record<string, unknown> = {}) {
    return {
      id: job.id,
      companyId: job.companyId,
      zohoInvoiceId: job.zohoInvoiceId,
      zohoInvoiceNumber: job.zohoInvoiceNumber,
      receiptId: job.receiptId,
      environment: job.environment,
      status: job.status,
      error: job.error,
      writeBackAt: job.writeBackAt,
      sourcePayload: job.sourcePayload,
      processedPayload: job.processedPayload,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...extra,
    };
  }

  private generateWebhookToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private getPublicApiBaseUrl(): string {
    const configured = this.configService.get<string>('PUBLIC_API_BASE_URL');
    if (configured) {
      return configured.replace(/\/$/, '');
    }
    const port = this.configService.get<string>('PORT') || '3000';
    const prefix = this.configService.get<string>('API_PREFIX') || 'api';
    return `http://localhost:${port}/${prefix}`;
  }

  private buildWebhookUrl(endpoint: ZohoWebhookEndpoint): string {
    return `${this.getPublicApiBaseUrl()}/zoho-books/hooks/${endpoint.webhookToken}`;
  }

  private toWebhookStatusResponse(endpoint: ZohoWebhookEndpoint) {
    const waiting =
      endpoint.status === ZohoWebhookStatus.PENDING || !endpoint.lastReceivedAt;
    return {
      configured: true,
      id: endpoint.id,
      companyId: endpoint.companyId,
      status: endpoint.status,
      connected: endpoint.status === ZohoWebhookStatus.CONNECTED,
      waitingForFirstEvent: waiting && endpoint.status !== ZohoWebhookStatus.DISABLED,
      webhookUrl: this.buildWebhookUrl(endpoint),
      environment: endpoint.environment,
      lastReceivedAt: endpoint.lastReceivedAt,
      lastEventType: endpoint.lastEventType,
      receiveCount: endpoint.receiveCount,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    };
  }

  private buildWebhookSetupInstructions(endpoint: ZohoWebhookEndpoint) {
    const url = this.buildWebhookUrl(endpoint);
    return {
      steps: [
        'In Zoho Books go to Settings → Automation → Workflows / Webhooks',
        'Create a webhook for Invoices (Created and/or Updated)',
        `Set the URL to: ${url}`,
        'Method: POST',
        'Body: Default payload (JSON) or Raw JSON including invoice_id / invoice_number',
        'Secure with the signing secret we provided, OR add custom header X-Zoho-Webhook-Token with that secret',
        'Save, then use Zoho’s Test action (or create a sample invoice)',
        'In our app, refresh webhook status — it should flip to connected',
      ],
      webhookUrl: url,
      customHeaderName: 'X-Zoho-Webhook-Token',
      testHint:
        'After adding in Zoho, call GET /zoho-books/:companyId/webhook — status should become connected when the first event arrives. You can also POST /zoho-books/:companyId/webhook/simulate to verify our side.',
    };
  }

  private verifyWebhookAuth(
    endpoint: ZohoWebhookEndpoint,
    headers: Record<string, string | string[] | undefined>,
    rawBody?: string | Buffer,
  ) {
    const secret = EncryptionUtil.decrypt(endpoint.signingSecretEncrypted);
    const normalize = (value?: string | string[]) =>
      Array.isArray(value) ? value[0] : value;

    const tokenHeader =
      normalize(headers['x-zoho-webhook-token']) ||
      normalize(headers['X-Zoho-Webhook-Token']) ||
      normalize(headers['x-webhook-token']);

    if (tokenHeader && tokenHeader === secret) {
      return;
    }

    const signature =
      normalize(headers['x-zb-webhooksignature']) ||
      normalize(headers['X-ZB-WebhookSignature']) ||
      normalize(headers['x-zoho-webhook-signature']);

    if (signature && rawBody) {
      const body =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const digest = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      const a = Buffer.from(digest);
      const b = Buffer.from(String(signature).replace(/^sha256=/i, ''));
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return;
      }
    }

    // If Zoho was configured without a secret, allow URL-token-only auth.
    // Prefer secrets in production; URL token is already unguessable.
    const requireSecret =
      this.configService.get<string>('ZOHO_WEBHOOK_REQUIRE_SECRET') === 'true';
    if (!requireSecret && !tokenHeader && !signature) {
      this.logger.warn(
        `Zoho webhook ${endpoint.companyId} accepted with URL token only (no secret header)`,
      );
      return;
    }

    throw new UnauthorizedException(
      'Invalid Zoho webhook signature or token. Ensure X-Zoho-Webhook-Token matches the issued secret.',
    );
  }

  private extractEventType(payload: any): string {
    return (
      payload?.event_type ||
      payload?.eventType ||
      payload?.event ||
      payload?.action ||
      (payload?.invoice || payload?.data?.invoice
        ? 'invoice.event'
        : 'zoho.webhook')
    );
  }

  private extractInvoiceFromPayload(payload: any): {
    invoiceId?: string;
    invoiceNumber?: string;
    raw: Record<string, unknown>;
  } | null {
    const invoice =
      payload?.invoice ||
      payload?.data?.invoice ||
      payload?.JSONString?.invoice ||
      (payload?.invoice_id || payload?.invoice_number ? payload : null);

    if (!invoice) {
      return null;
    }

    const invoiceId = String(
      invoice.invoice_id ||
        invoice.invoiceId ||
        invoice.id ||
        payload?.invoice_id ||
        '',
    );
    const invoiceNumber = String(
      invoice.invoice_number ||
        invoice.invoiceNumber ||
        invoice.number ||
        payload?.invoice_number ||
        '',
    );

    return {
      invoiceId: invoiceId || undefined,
      invoiceNumber: invoiceNumber || undefined,
      raw: invoice as Record<string, unknown>,
    };
  }

  private truncatePayload(payload: any): Record<string, unknown> {
    try {
      const json = JSON.stringify(payload);
      if (json.length <= 8000) {
        return payload as Record<string, unknown>;
      }
      return {
        truncated: true,
        preview: json.slice(0, 8000),
      };
    } catch {
      return { truncated: true };
    }
  }

  private async createJobFromWebhookPayload(
    endpoint: ZohoWebhookEndpoint,
    invoice: {
      invoiceId?: string;
      invoiceNumber?: string;
      raw: Record<string, unknown>;
    },
    fullPayload: any,
  ): Promise<ZohoInvoiceJob> {
    const zohoInvoiceId =
      invoice.invoiceId ||
      invoice.invoiceNumber ||
      `webhook-${Date.now()}`;

    const existingJobs = await this.zohoInvoiceJobRepository.find({
      where: { companyId: endpoint.companyId, zohoInvoiceId },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let job =
      existingJobs[0] ||
      this.zohoInvoiceJobRepository.create({
        companyId: endpoint.companyId,
        zohoInvoiceId,
      });

    job.zohoInvoiceNumber = invoice.invoiceNumber || job.zohoInvoiceNumber;
    job.environment = endpoint.environment || 'test';
    job.sourcePayload = {
      ...(invoice.raw || {}),
      _webhook: fullPayload,
      _source: 'zoho_webhook',
    };
    job.status = ZohoInvoiceJobStatus.IMPORTED;
    job.error = null;
    job = await this.zohoInvoiceJobRepository.save(job);

    try {
      const submitted = await this.receiptsService.submitForProcessing({
        companyId: endpoint.companyId,
        environment: job.environment,
        metadata: {
          source: 'zoho_books_webhook',
          zohoInvoiceId: job.zohoInvoiceId,
          zohoInvoiceNumber: job.zohoInvoiceNumber,
          invoice: invoice.raw,
          jobId: job.id,
        },
      });

      job.receiptId =
        submitted?.id ||
        submitted?.receiptId ||
        submitted?.receipt?.id ||
        job.receiptId;
      job.status = ZohoInvoiceJobStatus.SUBMITTED;
      job.processedPayload = submitted as Record<string, unknown>;
      job = await this.zohoInvoiceJobRepository.save(job);
      job = await this.refreshJobFromReceiptService(job);
    } catch (error: any) {
      const message =
        error instanceof HttpException
          ? JSON.stringify(error.getResponse())
          : error.message;
      job.status = ZohoInvoiceJobStatus.FAILED;
      job.error = `Receipt service submit failed: ${message}`;
      job = await this.zohoInvoiceJobRepository.save(job);
      this.logger.error(
        `Webhook invoice submit failed for ${zohoInvoiceId}: ${message}`,
      );
    }

    return job;
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Zoho Books is not configured. Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET.',
      );
    }
  }

  private async requireConnection(companyId: string): Promise<ZohoConnection> {
    const connection = await this.zohoConnectionRepository.findOne({
      where: { companyId, isActive: true },
    });
    if (!connection) {
      throw new BadRequestException(
        'Zoho Books is not connected for this company. Start OAuth via GET /zoho-books/:companyId/connect',
      );
    }
    if (!connection.organizationId) {
      throw new BadRequestException(
        'Zoho organization not set. Call PUT /zoho-books/:companyId/organization',
      );
    }
    return connection;
  }

  private async fetchOrganizations(accessToken: string, apiDomain: string) {
    const { data } = await axios.get(`${apiDomain}/books/v3/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    return data.organizations || [];
  }

  private async getAuthedClient(
    companyId: string,
    options?: { responseType?: 'json' | 'arraybuffer'; accept?: string },
  ): Promise<AxiosInstance> {
    let connection = await this.requireConnection(companyId);
    connection = await this.refreshTokenIfNeeded(connection);

    const accessToken = EncryptionUtil.decrypt(connection.accessToken);
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    };

    if (options?.accept) {
      headers.Accept = options.accept;
    } else {
      headers['Content-Type'] = 'application/json';
    }

    return axios.create({
      baseURL: connection.apiDomain,
      headers,
      responseType: options?.responseType || 'json',
    });
  }

  private async refreshTokenIfNeeded(
    connection: ZohoConnection,
  ): Promise<ZohoConnection> {
    const bufferMs = 5 * 60 * 1000;
    if (connection.expiresAt.getTime() - Date.now() > bufferMs) {
      return connection;
    }

    this.logger.log(`Refreshing Zoho token for company ${connection.companyId}`);

    try {
      const refreshToken = EncryptionUtil.decrypt(connection.refreshToken);
      const { data } = await axios.post(
        `${connection.accountsDomain}/oauth/v2/token`,
        null,
        {
          params: {
            grant_type: 'refresh_token',
            client_id: this.configService.get<string>('ZOHO_CLIENT_ID'),
            client_secret: this.configService.get<string>('ZOHO_CLIENT_SECRET'),
            refresh_token: refreshToken,
          },
        },
      );

      if (!data.access_token) {
        throw new Error('No access_token in refresh response');
      }

      connection.accessToken = EncryptionUtil.encrypt(data.access_token);
      connection.expiresAt = new Date(
        Date.now() + (data.expires_in || 3600) * 1000,
      );
      if (data.api_domain) {
        connection.apiDomain = data.api_domain;
      }

      return this.zohoConnectionRepository.save(connection);
    } catch (error: any) {
      this.logger.error(
        `Zoho token refresh failed: ${error.response?.data || error.message}`,
      );
      throw new ServiceUnavailableException(
        'Zoho session expired. Reconnect via GET /zoho-books/:companyId/connect',
      );
    }
  }
}
