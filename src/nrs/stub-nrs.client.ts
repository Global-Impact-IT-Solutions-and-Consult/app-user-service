import { Injectable } from '@nestjs/common';
import { NrsClient, NrsInvoicePayload, NrsSubmitResult } from './nrs.types';

@Injectable()
export class StubNrsClient implements NrsClient {
  async submitInvoice(payload: NrsInvoicePayload): Promise<NrsSubmitResult> {
    return this.fixture(payload.irn, payload);
  }

  async getInvoiceByIrn(irn: string): Promise<NrsSubmitResult> {
    return this.fixture(irn);
  }

  private fixture(
    irn: string,
    signedPayload?: Record<string, unknown>,
  ): NrsSubmitResult {
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    return {
      IRN: irn,
      PostingDateTime: stamp,
      QRCodeData: Buffer.from(`NRS-STUB:${irn}`).toString('base64'),
      CSID: `STUB-CSID-${irn}`,
      signedPayload: signedPayload || { irn, stub: true },
      stub: true,
    };
  }
}
