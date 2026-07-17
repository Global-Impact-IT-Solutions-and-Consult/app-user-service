import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private isConfigured = false;
  private fromAddress: string;

  constructor(private configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('SMTP_PASS');

    this.fromAddress =
      this.configService.get<string>('RESEND_FROM') ||
      this.configService.get<string>('SMTP_FROM') ||
      'noreply@userservice.com';

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.isConfigured = true;
    } else {
      this.logger.warn(
        'Resend not configured. OTPs will be logged to console instead of sent via email.',
      );
    }
  }

  async sendOTP(email: string, otpCode: string): Promise<void> {
    const subject = 'Your OTP Code for User Service';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">OTP Verification Code</h2>
          <p>Your One-Time Password (OTP) for authentication is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${otpCode}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `;
    const text = `Your OTP code is: ${otpCode}. This code will expire in 10 minutes.`;

    await this.send({ to: email, subject, html, text, otpFallback: otpCode });
  }

  async sendWelcomeEmail(email: string, name?: string): Promise<void> {
    const subject = 'Welcome to User Service';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome${name ? `, ${name}` : ''}!</h2>
          <p>Thank you for signing up for User Service. Your account has been successfully created.</p>
          <p>You can now log in and start using our services.</p>
        </div>
      `;

    await this.send({ to: email, subject, html, critical: false });
  }

  private async send(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    otpFallback?: string;
    critical?: boolean;
  }): Promise<void> {
    const { to, subject, html, text, otpFallback, critical = true } = options;

    if (!this.isConfigured || !this.resend) {
      if (otpFallback) {
        this.logger.log(
          `[DEV MODE] OTP for ${to}: ${otpFallback} (expires in 10 minutes)`,
        );
      } else {
        this.logger.log(`[DEV MODE] Email "${subject}" would be sent to ${to}`);
      }
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Email "${subject}" sent to ${to}`);
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`);

      if (otpFallback) {
        this.logger.warn(`[FALLBACK] OTP for ${to}: ${otpFallback}`);
      }

      if (
        critical &&
        this.configService.get<string>('NODE_ENV') === 'production'
      ) {
        throw new Error(`Failed to send email to ${to}: ${error.message}`);
      }
    }
  }
}
