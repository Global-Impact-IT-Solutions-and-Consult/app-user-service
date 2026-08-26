import { InvoiceLine, InvoiceSource } from './entities/invoice.entity';

export type NormalizedInvoice = {
  invoiceNumber?: string;
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: string;
  subtotal?: number | null;
  taxTotal?: number | null;
  total?: number | null;
  status?: string;
  buyerName?: string;
  buyerTin?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  lines: InvoiceLine[];
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const xeroMatch = value.match(/\/Date\((\d+)/);
    if (xeroMatch) {
      return new Date(Number(xeroMatch[1])).toISOString().slice(0, 10);
    }
    const iso = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return iso;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function fromXero(payload: Record<string, any>): NormalizedInvoice {
  const contact = payload.Contact || payload.contact || {};
  const lineItems = payload.LineItems || payload.lineItems || [];
  const lines: InvoiceLine[] = (Array.isArray(lineItems) ? lineItems : []).map(
    (line: any) => ({
      description: line.Description || line.ItemCode,
      quantity: toNumber(line.Quantity) ?? undefined,
      unitPrice: toNumber(line.UnitAmount) ?? undefined,
      amount: toNumber(line.LineAmount) ?? undefined,
      taxRate: toNumber(line.TaxRate) ?? undefined,
      taxAmount: toNumber(line.TaxAmount) ?? undefined,
      unit: line.Unit || 'EA',
    }),
  );

  return {
    invoiceNumber: payload.InvoiceNumber || payload.invoiceNumber,
    issueDate: toDateString(payload.DateString || payload.Date || payload.date),
    dueDate: toDateString(payload.DueDateString || payload.DueDate || payload.dueDate),
    currency: payload.CurrencyCode || payload.currencyCode,
    subtotal: toNumber(payload.SubTotal),
    taxTotal: toNumber(payload.TotalTax),
    total: toNumber(payload.Total),
    status: payload.Status || payload.status,
    buyerName: contact.Name || contact.name,
    buyerTin:
      contact.TaxNumber ||
      contact.taxNumber ||
      contact.CompanyNumber ||
      undefined,
    buyerEmail: contact.EmailAddress || contact.emailAddress || contact.email,
    buyerPhone:
      contact.Phones?.[0]?.PhoneNumber ||
      contact.Phone ||
      contact.phone ||
      undefined,
    lines,
  };
}

function fromQuickBooks(payload: Record<string, any>): NormalizedInvoice {
  const taxDetail = payload.TxnTaxDetail || {};
  const linesRaw = Array.isArray(payload.Line) ? payload.Line : [];
  const lines: InvoiceLine[] = linesRaw
    .filter((line: any) => line.DetailType === 'SalesItemLineDetail' || line.Amount)
    .filter((line: any) => line.DetailType !== 'SubTotalLineDetail')
    .map((line: any) => {
      const detail = line.SalesItemLineDetail || {};
      const qty = toNumber(detail.Qty);
      const unitPrice = toNumber(detail.UnitPrice);
      const amount = toNumber(line.Amount);
      return {
        description:
          line.Description || detail.ItemRef?.name || line.DetailType,
        quantity: qty ?? undefined,
        unitPrice: unitPrice ?? undefined,
        amount: amount ?? undefined,
        taxAmount: toNumber(detail.TaxInclusiveAmt) ?? undefined,
        unit: 'EA',
      };
    });

  return {
    invoiceNumber: payload.DocNumber || payload.docNumber,
    issueDate: toDateString(payload.TxnDate),
    dueDate: toDateString(payload.DueDate),
    currency: payload.CurrencyRef?.value || payload.CurrencyRef,
    subtotal: toNumber(payload.TotalAmt) != null
      ? (toNumber(payload.TotalAmt)! - (toNumber(taxDetail.TotalTax) || 0))
      : null,
    taxTotal: toNumber(taxDetail.TotalTax),
    total: toNumber(payload.TotalAmt),
    status: payload.EmailStatus || payload.PrivateNote || undefined,
    buyerName: payload.CustomerRef?.name,
    buyerTin: payload.BillAddr?.CountrySubDivisionCode,
    buyerEmail: payload.BillEmail?.Address || payload.PrimaryEmailAddr?.Address,
    buyerPhone:
      payload.PrimaryPhone?.FreeFormNumber ||
      payload.BillAddr?.Phone ||
      undefined,
    lines,
  };
}

function fromZoho(payload: Record<string, any>): NormalizedInvoice {
  const lineItems = payload.line_items || payload.lineItems || [];
  const lines: InvoiceLine[] = (Array.isArray(lineItems) ? lineItems : []).map(
    (line: any) => ({
      description: line.name || line.description || line.item_name,
      quantity: toNumber(line.quantity) ?? undefined,
      unitPrice: toNumber(line.rate) ?? undefined,
      amount: toNumber(line.item_total || line.bcy_rate) ?? undefined,
      taxRate: toNumber(line.tax_percentage) ?? undefined,
      taxAmount: toNumber(line.tax_amount || line.item_total_tax) ?? undefined,
      hsnCode: line.hsn_or_sac || line.hsn_code,
      unit: line.unit || 'EA',
    }),
  );

  return {
    invoiceNumber: payload.invoice_number || payload.number,
    issueDate: toDateString(payload.date),
    dueDate: toDateString(payload.due_date || payload.dueDate),
    currency: payload.currency_code,
    subtotal: toNumber(payload.sub_total),
    taxTotal: toNumber(payload.tax_total || payload.tax_amount),
    total: toNumber(payload.total),
    status: payload.status,
    buyerName: payload.customer_name,
    buyerTin:
      payload.gst_no ||
      payload.tax_id ||
      payload.vat_reg_no ||
      payload.customer_tax_id,
    buyerEmail:
      payload.email ||
      payload.customer_email ||
      payload.contact_persons?.[0]?.email,
    buyerPhone:
      payload.phone ||
      payload.customer_phone ||
      payload.contact_persons?.[0]?.phone,
    lines,
  };
}

export function normalizeErpInvoice(
  source: InvoiceSource,
  payload: Record<string, any>,
): NormalizedInvoice {
  if (source === InvoiceSource.XERO) {
    return fromXero(payload);
  }
  if (source === InvoiceSource.QUICKBOOKS) {
    return fromQuickBooks(payload);
  }
  if (source === InvoiceSource.ZOHO_BOOKS) {
    return fromZoho(payload);
  }
  return fromZoho(payload);
}
