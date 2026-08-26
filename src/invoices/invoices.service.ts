import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  Invoice,
  InvoiceSource,
  NrsInvoiceStatus,
} from './entities/invoice.entity';
import { Company } from '../companies/entities/company.entity';
import { LoggingService } from '../logging/logging.service';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { CreateManualInvoiceDto } from './dto/create-manual-invoice.dto';
import { normalizeErpInvoice } from './erp-invoice.normalizer';
import { NrsMapper } from '../nrs/nrs.mapper';
import { NRS_CLIENT, NrsClient } from '../nrs/nrs.types';

export type UpsertErpInvoiceInput = {
  companyId: string;
  environment: string;
  source: InvoiceSource;
  externalId: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private loggingService: LoggingService,
    private nrsMapper: NrsMapper,
    @Inject(NRS_CLIENT) private nrsClient: NrsClient,
  ) {}

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

  async upsertFromErp(input: UpsertErpInvoiceInput): Promise<Invoice | null> {
    try {
      const company = await this.companyRepository.findOne({
        where: { id: input.companyId },
      });
      if (!company) {
        this.logger.warn(
          `Skip invoice store: company ${input.companyId} not found`,
        );
        return null;
      }

      const normalized = normalizeErpInvoice(input.source, input.payload);
      let invoice = await this.invoiceRepository.findOne({
        where: {
          companyId: input.companyId,
          source: input.source,
          externalId: String(input.externalId),
        },
      });

      const isNew = !invoice;
      if (!invoice) {
        invoice = this.invoiceRepository.create({
          companyId: input.companyId,
          source: input.source,
          externalId: String(input.externalId),
          nrsStatus: NrsInvoiceStatus.NOT_SUBMITTED,
        });
      }

      invoice.environment = input.environment || 'test';
      invoice.invoiceNumber = normalized.invoiceNumber || invoice.invoiceNumber;
      invoice.issueDate = normalized.issueDate ?? invoice.issueDate;
      invoice.dueDate = normalized.dueDate ?? invoice.dueDate;
      invoice.currency = normalized.currency || invoice.currency || 'NGN';
      invoice.subtotal =
        normalized.subtotal != null ? String(normalized.subtotal) : invoice.subtotal;
      invoice.taxTotal =
        normalized.taxTotal != null ? String(normalized.taxTotal) : invoice.taxTotal;
      invoice.total =
        normalized.total != null ? String(normalized.total) : invoice.total;
      invoice.status = normalized.status || invoice.status;
      invoice.sellerName = company.legalName || company.name;
      invoice.sellerTin = company.taxId || invoice.sellerTin;
      invoice.buyerName = normalized.buyerName || invoice.buyerName;
      invoice.buyerTin = normalized.buyerTin || invoice.buyerTin;
      invoice.buyerEmail = normalized.buyerEmail || invoice.buyerEmail;
      invoice.buyerPhone = normalized.buyerPhone || invoice.buyerPhone;
      invoice.lines = normalized.lines;
      invoice.sourcePayload = input.payload;

      invoice = await this.invoiceRepository.save(invoice);

      if (isNew) {
        await this.loggingService.safeCreateLog({
          companyId: invoice.companyId,
          environment: invoice.environment,
          eventType: 'invoice.stored',
          message: `Stored ${invoice.source} invoice ${invoice.invoiceNumber || invoice.externalId}`,
          level: 'info',
          metadata: {
            invoiceId: invoice.id,
            source: invoice.source,
            externalId: invoice.externalId,
            invoiceNumber: invoice.invoiceNumber,
          },
        });
      }

      return invoice;
    } catch (error: any) {
      this.logger.warn(
        `Failed to store ${input.source} invoice ${input.externalId}: ${error.message}`,
      );
      return null;
    }
  }

  async createManual(
    companyId: string,
    userId: string,
    dto: CreateManualInvoiceDto,
  ) {
    const company = await this.assertCompanyMember(companyId, userId);
    const invoiceNumber =
      dto.invoiceNumber ||
      `GIITSC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;

    const lines = dto.lineItems.map((line) => {
      const amount = this.round(line.quantity * line.rate);
      const taxRate = line.taxRate ?? 0;
      const taxAmount = this.round((amount * taxRate) / 100);
      return {
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.rate,
        amount,
        taxRate,
        taxAmount,
        unit: 'EA',
      };
    });
    const subtotal = this.round(lines.reduce((sum, line) => sum + (line.amount || 0), 0));
    const taxTotal = this.round(lines.reduce((sum, line) => sum + (line.taxAmount || 0), 0));
    const total = this.round(subtotal + taxTotal);

    let invoice = this.invoiceRepository.create({
      companyId,
      environment: 'test',
      source: InvoiceSource.MANUAL,
      externalId: invoiceNumber,
      invoiceNumber,
      issueDate: dto.invoiceDate,
      dueDate: dto.dueDate,
      currency: dto.currency || 'NGN',
      subtotal: String(subtotal),
      taxTotal: String(taxTotal),
      total: String(total),
      status: 'draft',
      sellerName: company.legalName || company.name,
      sellerTin: company.taxId,
      buyerName: dto.customerName,
      buyerTin: dto.customerTaxId || null,
      buyerEmail: dto.customerEmail || null,
      buyerPhone: dto.customerPhone || null,
      notes: dto.notes || null,
      lines,
      sourcePayload: dto as unknown as Record<string, unknown>,
      nrsStatus: NrsInvoiceStatus.NOT_SUBMITTED,
    });

    invoice = await this.invoiceRepository.save(invoice);

    await this.loggingService.safeCreateLog({
      companyId,
      environment: invoice.environment,
      eventType: 'invoice.manual.created',
      message: `Manual invoice ${invoice.invoiceNumber} created`,
      level: 'info',
      metadata: {
        invoiceId: invoice.id,
        userId,
        sendInvoice: Boolean(dto.sendInvoice),
      },
    });

    if (dto.sendInvoice) {
      const submitted = await this.submitNrs(companyId, invoice.id);
      return {
        invoice: await this.get(companyId, invoice.id),
        nrs: submitted,
      };
    }

    return { invoice: this.toResponse(invoice) };
  }

  async list(companyId: string, query: QueryInvoicesDto) {
    const page = query.page || 1;
    const perPage = query.perPage || 25;
    const where: Record<string, unknown> = { companyId };
    if (query.source) {
      where.source = query.source;
    }
    if (query.nrsStatus) {
      where.nrsStatus = query.nrsStatus;
    }
    if (query.search) {
      where.invoiceNumber = ILike(`%${query.search}%`);
    }

    const [items, total] = await this.invoiceRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return {
      items: items.map((invoice) => this.toResponse(invoice)),
      total,
      page,
      perPage,
    };
  }

  async get(companyId: string, invoiceId: string) {
    const invoice = await this.requireInvoice(companyId, invoiceId);
    return this.toResponse(invoice);
  }

  async previewNrs(companyId: string, invoiceId: string) {
    const invoice = await this.requireInvoice(companyId, invoiceId);
    const company = await this.requireCompany(companyId);
    const payload = this.nrsMapper.toNrsPayload(invoice, company);

    invoice.nrsPayload = payload;
    if (invoice.nrsStatus === NrsInvoiceStatus.NOT_SUBMITTED) {
      invoice.nrsStatus = NrsInvoiceStatus.PREVIEWED;
    }
    await this.invoiceRepository.save(invoice);

    return { payload };
  }

  async submitNrs(companyId: string, invoiceId: string) {
    const invoice = await this.requireInvoice(companyId, invoiceId);
    const company = await this.requireCompany(companyId);

    try {
      const payload = this.nrsMapper.toNrsPayload(invoice, company);
      invoice.nrsPayload = payload;

      const submitted = await this.nrsClient.submitInvoice(payload);
      let retrieved = submitted;
      try {
        retrieved = await this.nrsClient.getInvoiceByIrn(submitted.IRN);
      } catch {
        retrieved = submitted;
      }

      invoice.irn = retrieved.IRN || submitted.IRN;
      invoice.csid = retrieved.CSID || submitted.CSID || null;
      invoice.qrCodeData = retrieved.QRCodeData || submitted.QRCodeData;
      invoice.nrsResponse = retrieved as unknown as Record<string, unknown>;
      invoice.nrsStatus = NrsInvoiceStatus.SUBMITTED;
      invoice.status = 'sent';
      invoice.sentAt = new Date();
      invoice.nrsError = null;
      await this.invoiceRepository.save(invoice);

      await this.loggingService.safeCreateLog({
        companyId,
        environment: invoice.environment,
        eventType: 'nrs.submit.completed',
        message: `NRS clearance stored for invoice ${invoice.invoiceNumber || invoice.id}`,
        level: 'info',
        metadata: {
          invoiceId: invoice.id,
          irn: invoice.irn,
          stub: Boolean(retrieved.stub || submitted.stub),
        },
      });

      return this.toNrsResponse(invoice);
    } catch (error: any) {
      invoice.nrsStatus = NrsInvoiceStatus.FAILED;
      invoice.nrsError = error.message;
      await this.invoiceRepository.save(invoice);

      await this.loggingService.safeCreateLog({
        companyId,
        environment: invoice.environment,
        eventType: 'nrs.submit.failed',
        message: `NRS submit failed: ${error.message}`,
        level: 'error',
        metadata: {
          invoiceId: invoice.id,
          error: error.message,
        },
      });

      throw error;
    }
  }

  async getNrsArtefacts(companyId: string, invoiceId: string) {
    const invoice = await this.requireInvoice(companyId, invoiceId);
    return this.toNrsResponse(invoice);
  }

  private async requireInvoice(companyId: string, invoiceId: string) {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId, companyId },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    return invoice;
  }

  private async requireCompany(companyId: string) {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
    return company;
  }

  private toResponse(invoice: Invoice) {
    return {
      id: invoice.id,
      companyId: invoice.companyId,
      environment: invoice.environment,
      source: invoice.source,
      externalId: invoice.externalId,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      status: invoice.status,
      sellerName: invoice.sellerName,
      sellerTin: invoice.sellerTin,
      buyerName: invoice.buyerName,
      buyerTin: invoice.buyerTin,
      buyerEmail: invoice.buyerEmail,
      buyerPhone: invoice.buyerPhone,
      notes: invoice.notes,
      lines: invoice.lines,
      nrsStatus: invoice.nrsStatus,
      irn: invoice.irn,
      sentAt: invoice.sentAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toNrsResponse(invoice: Invoice) {
    return {
      invoiceId: invoice.id,
      nrsStatus: invoice.nrsStatus,
      irn: invoice.irn,
      csid: invoice.csid,
      qrCodeData: invoice.qrCodeData,
      payload: invoice.nrsPayload,
      response: invoice.nrsResponse,
      error: invoice.nrsError,
    };
  }
}
