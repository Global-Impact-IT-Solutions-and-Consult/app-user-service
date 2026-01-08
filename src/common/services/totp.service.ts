import { Injectable } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

@Injectable()
export class TotpService {
  /**
   * Generate a TOTP secret for a user
   */
  generateSecret(email: string, serviceName: string = 'GIITSC'): string {
    return speakeasy.generateSecret({
      name: `${serviceName} (${email})`,
      issuer: serviceName,
      length: 32,
    }).base32;
  }

  /**
   * Generate QR code data URL for authenticator app setup
   */
  async generateQRCode(secret: string, email: string, serviceName: string = 'GIITSC'): Promise<string> {
    const otpauthUrl = speakeasy.otpauthURL({
      secret,
      label: email,
      issuer: serviceName,
      encoding: 'base32',
    });

    return QRCode.toDataURL(otpauthUrl);
  }

  /**
   * Verify a TOTP token against a secret
   */
  verifyToken(token: string, secret: string, window: number = 2): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window, // Allow tokens from ±2 time steps (60 seconds each)
    });
  }

}

