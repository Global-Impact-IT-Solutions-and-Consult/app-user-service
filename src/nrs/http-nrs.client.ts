import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NrsClient, NrsInvoicePayload, NrsSubmitResult } from './nrs.types';

/**
 * Interswitch-shaped APP client. Unused until NRS_ENABLED=true and credentials exist.
 */
@Injectable()
export class HttpNrsClient implements NrsClient {
  private readonly logger = new Logger(HttpNrsClient.name);

  constructor(private configService: ConfigService) {}

  async submitInvoice(payload: NrsInvoicePayload): Promise<NrsSubmitResult> {
    const token = await this.getAccessToken();
    const { data } = await axios.post(
      `${this.getBaseUrl()}/Api/SwitchTax/postInvoice`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const body = data?.data || data;
    if (!body?.IRN) {
      this.logger.error(`NRS submit missing IRN: ${JSON.stringify(data)}`);
      throw new ServiceUnavailableException(
        'NRS did not return an IRN for this invoice',
      );
    }

    return {
      IRN: body.IRN,
      PostingDateTime: body.PostingDateTime,
      QRCodeData: body.QRCodeData,
      CSID: body.CSID,
      signedPayload: body,
    };
  }

  async getInvoiceByIrn(irn: string): Promise<NrsSubmitResult> {
    const token = await this.getAccessToken();
    const path =
      this.configService.get<string>('NRS_GET_INVOICE_PATH') ||
      `/Api/SwitchTax/invoices/${encodeURIComponent(irn)}`;

    try {
      const { data } = await axios.get(`${this.getBaseUrl()}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = data?.data || data;
      return {
        IRN: body.IRN || irn,
        PostingDateTime: body.PostingDateTime,
        QRCodeData: body.QRCodeData,
        CSID: body.CSID,
        signedPayload: body,
      };
    } catch (error: any) {
      this.logger.warn(
        `NRS retrieve by IRN not available (${error.message}). Using submit artefacts only.`,
      );
      throw new ServiceUnavailableException(
        `Could not retrieve signed invoice ${irn} from NRS. Store the submit response instead.`,
      );
    }
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>('NRS_API_BASE_URL') ||
      'https://sandbox-api.interswitchng.com'
    );
  }

  private async getAccessToken(): Promise<string> {
    const clientId = this.configService.get<string>('NRS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NRS_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'NRS_ENABLED is true but NRS_CLIENT_ID / NRS_CLIENT_SECRET are not set.',
      );
    }

    const tokenUrl =
      this.configService.get<string>('NRS_TOKEN_URL') ||
      `${this.getBaseUrl()}/Api/SwitchTax/Token`;

    const { data } = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const token = data?.access_token || data?.data?.access_token;
    if (!token) {
      throw new ServiceUnavailableException(
        'NRS token endpoint did not return access_token',
      );
    }
    return token;
  }
}
