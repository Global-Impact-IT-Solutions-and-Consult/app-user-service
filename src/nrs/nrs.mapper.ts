import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Company } from '../companies/entities/company.entity';
import {
  NrsInvoicePayload,
  STANDARD_VAT_PERCENT,
  VAT_AMOUNT_TOLERANCE,
  NrsTaxCategoryId,
} from './nrs.types';

@Injectable()
export class NrsMapper {
  constructor(private configService: ConfigService) {}

  toNrsPayload(invoice: Invoice, company: Company): NrsInvoicePayload {
    const serviceId =
      this.configService.get<string>('NRS_SERVICE_ID') || 'STUB01';
    const businessId =
      this.configService.get<string>('NRS_BUSINESS_ID') || company.id;
    const sellerTin =
      this.configService.get<string>('NRS_SUPPLIER_TIN') ||
      invoice.sellerTin ||
      company.taxId;
    const invoiceNumber = this.sanitizeInvoiceNo(
      invoice.invoiceNumber || invoice.externalId,
    );
    const issueDate = invoice.issueDate || new Date().toISOString().slice(0, 10);
    const dueDate = invoice.dueDate || issueDate;
    const irn = `${invoiceNumber}-${serviceId}-${issueDate.replace(/-/g, '')}`;

    if (!sellerTin) {
      throw new BadRequestException(
        'Supplier TIN is required for NRS. Set company taxId or NRS_SUPPLIER_TIN.',
      );
    }

    const lines = invoice.lines || [];
    if (!lines.length) {
      throw new BadRequestException(
        'Invoice has no line items to map for NRS.',
      );
    }

    const invoiceLines = lines.map((line, index) => {
      const qty = Number(line.quantity ?? 1);
      const unitPrice = Number(line.unitPrice ?? 0);
      const amount =
        Number(line.amount ?? qty * unitPrice) || 0;
      const item: Record<string, unknown> = {
        invoiced_quantity: qty,
        line_extension_amount: this.round(amount),
        discount_rate: 0,
        discount_amount: 0,
        fee_rate: 0,
        fee_amount: 0,
        item: {
          name: line.description || `Line ${index + 1}`,
          description: line.description || `Line ${index + 1}`,
          sellers_item_identification:
            line.hsnCode || line.isicCode || String(index + 1),
        },
        price: {
          price_amount: this.round(unitPrice || amount / (qty || 1)),
          base_quantity: 1,
          price_unit: line.unit || 'EA',
        },
      };
      if (line.hsnCode) {
        item.hsn_code = line.hsnCode;
        item.product_category = line.description || line.hsnCode;
      } else if (line.isicCode) {
        item.isic_code = line.isicCode;
        item.service_category = line.description || line.isicCode;
      } else {
        item.isic_code = '0000';
        item.service_category = line.description || 'General';
      }
      return item;
    });

    const taxGroups = this.buildTaxGroups(invoice);
    const taxExclusive =
      Number(invoice.subtotal) ||
      taxGroups.reduce((sum, g) => sum + g.taxable_amount, 0);
    const taxAmount =
      Number(invoice.taxTotal) ||
      taxGroups.reduce((sum, g) => sum + g.tax_amount, 0);
    const payable =
      Number(invoice.total) || this.round(taxExclusive + taxAmount);

    const payload: NrsInvoicePayload = {
      business_id: businessId,
      irn,
      invoice_kind: 'B2B',
      issue_date: issueDate,
      due_date: dueDate,
      issue_time: new Date().toISOString().slice(11, 19),
      invoice_type_code: '381',
      payment_status: 'PENDING',
      tax_point_date: issueDate,
      document_currency_code: invoice.currency || 'NGN',
      tax_currency_code: invoice.currency || 'NGN',
      accounting_supplier_party: {
        party_name: invoice.sellerName || company.legalName || company.name,
        tin: sellerTin,
        email:
          this.configService.get<string>('NRS_SUPPLIER_EMAIL') ||
          company.contactEmail ||
          undefined,
        telephone:
          this.configService.get<string>('NRS_SUPPLIER_PHONE') ||
          company.contactPhone ||
          undefined,
        business_description: company.industry || 'General',
        postal_address: {
          street_name:
            this.configService.get<string>('NRS_SUPPLIER_STREET') ||
            company.registeredAddress ||
            'N/A',
          city_name:
            this.configService.get<string>('NRS_SUPPLIER_CITY') || 'Lagos',
          postal_zone: '',
          country: 'NG',
        },
      },
      accounting_customer_party: {
        party_name: invoice.buyerName || 'Customer',
        tin: invoice.buyerTin || sellerTin,
        email: invoice.buyerEmail || undefined,
        telephone: invoice.buyerPhone || undefined,
        business_description: null,
        postal_address: {
          street_name: 'N/A',
          city_name: 'Lagos',
          postal_zone: '',
          country: 'NG',
        },
      },
      invoice_line: invoiceLines,
      tax_total: [
        {
          tax_amount: this.round(taxAmount),
          tax_subtotal: taxGroups.map((g) => ({
            taxable_amount: this.round(g.taxable_amount),
            tax_amount: this.round(g.tax_amount),
            tax_category: {
              id: g.id,
              percent: g.percent,
            },
          })),
        },
      ],
      legal_monetary_total: {
        line_extension_amount: this.round(taxExclusive),
        tax_exclusive_amount: this.round(taxExclusive),
        tax_inclusive_amount: this.round(payable),
        payable_amount: this.round(payable),
      },
    };

    this.assertVatMath(payload);
    return payload;
  }

  private buildTaxGroups(invoice: Invoice): Array<{
    id: NrsTaxCategoryId;
    percent: number;
    taxable_amount: number;
    tax_amount: number;
  }> {
    const groups = new Map<
      string,
      {
        id: NrsTaxCategoryId;
        percent: number;
        taxable_amount: number;
        tax_amount: number;
      }
    >();

    const lines = invoice.lines || [];
    if (!lines.length) {
      const taxable = Number(invoice.subtotal) || 0;
      const tax = Number(invoice.taxTotal) || 0;
      const category = this.classifyRate(
        taxable > 0 ? (tax / taxable) * 100 : 0,
      );
      groups.set(category.id, {
        ...category,
        taxable_amount: taxable,
        tax_amount: tax,
      });
      return [...groups.values()];
    }

    for (const line of lines) {
      const amount = Number(line.amount ?? 0);
      let rate = line.taxRate;
      if (rate == null && amount && line.taxAmount != null) {
        rate = (Number(line.taxAmount) / amount) * 100;
      }
      if (rate == null && Number(invoice.subtotal) && Number(invoice.taxTotal)) {
        rate =
          (Number(invoice.taxTotal) / Number(invoice.subtotal)) * 100;
      }
      const category = this.classifyRate(rate ?? 0);
      const current = groups.get(category.id) || {
        ...category,
        taxable_amount: 0,
        tax_amount: 0,
      };
      current.taxable_amount += amount;
      current.tax_amount += Number(line.taxAmount ?? (amount * category.percent) / 100);
      groups.set(category.id, current);
    }

    return [...groups.values()];
  }

  private classifyRate(rate: number): { id: NrsTaxCategoryId; percent: number } {
    if (Math.abs(rate - STANDARD_VAT_PERCENT) <= 0.3) {
      return { id: 'STANDARD_VAT', percent: STANDARD_VAT_PERCENT };
    }
    if (Math.abs(rate) <= 0.3) {
      return { id: 'ZERO_VAT', percent: 0 };
    }
    throw new BadRequestException(
      `Unsupported VAT rate ${rate.toFixed(2)}%. NRS mapping accepts STANDARD_VAT (7.5%) or ZERO_VAT (0%).`,
    );
  }

  private assertVatMath(payload: NrsInvoicePayload) {
    const taxTotal = payload.tax_total[0] as {
      tax_subtotal: Array<{
        taxable_amount: number;
        tax_amount: number;
        tax_category: { id: string; percent: number };
      }>;
    };
    for (const sub of taxTotal.tax_subtotal || []) {
      if (sub.tax_category.id !== 'STANDARD_VAT') {
        continue;
      }
      const expected =
        (Number(sub.taxable_amount) * STANDARD_VAT_PERCENT) / 100;
      if (Math.abs(expected - Number(sub.tax_amount)) > VAT_AMOUNT_TOLERANCE) {
        throw new BadRequestException(
          `VAT on taxable ${sub.taxable_amount} is ${sub.tax_amount}, expected ${this.round(expected)} at 7.5%.`,
        );
      }
    }
  }

  private sanitizeInvoiceNo(value: string): string {
    const cleaned = String(value || 'INV')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 20);
    return cleaned || 'INV';
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
