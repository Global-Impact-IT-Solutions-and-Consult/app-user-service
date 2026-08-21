export const NRS_CLIENT = 'NRS_CLIENT';

export const STANDARD_VAT_PERCENT = 7.5;
export const VAT_AMOUNT_TOLERANCE = 0.05;

export type NrsTaxCategoryId =
  | 'STANDARD_VAT'
  | 'ZERO_VAT'
  | 'EXEMPTED'
  | 'Withholding_Tax'
  | 'Stamp_Duty';

export type NrsInvoicePayload = {
  business_id: string;
  irn: string;
  invoice_kind: 'B2B' | 'B2C' | 'B2G';
  issue_date: string;
  due_date?: string;
  issue_time?: string;
  invoice_type_code: string;
  payment_status: string;
  tax_point_date?: string;
  document_currency_code: string;
  tax_currency_code: string;
  accounting_supplier_party: Record<string, unknown>;
  accounting_customer_party: Record<string, unknown>;
  invoice_line: Array<Record<string, unknown>>;
  tax_total: Array<Record<string, unknown>>;
  legal_monetary_total: Record<string, unknown>;
};

export type NrsSubmitResult = {
  IRN: string;
  PostingDateTime: string;
  QRCodeData: string;
  CSID?: string;
  signedPayload?: Record<string, unknown>;
  stub?: boolean;
};

export interface NrsClient {
  submitInvoice(payload: NrsInvoicePayload): Promise<NrsSubmitResult>;
  getInvoiceByIrn(irn: string): Promise<NrsSubmitResult>;
}
