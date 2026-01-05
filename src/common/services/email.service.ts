import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private isConfigured: boolean = false;

  constructor(private configService: ConfigService) {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');

    if (smtpUser && smtpPass) {
      // Create transporter with actual SMTP config
      const emailConfig = {
        host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
        port: parseInt(this.configService.get<string>('SMTP_PORT') || '587'),
        secure: this.configService.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      };
      this.transporter = nodemailer.createTransport(emailConfig);
      this.isConfigured = true;
    } else {
      console.log(
        '[DEV MODE] SMTP not configured. OTPs will be logged to console instead of sent via email.',
      );
      this.isConfigured = false;
    }
  }

  async sendOTP(email: string, otpCode: string): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        'noreply@userservice.com',
      to: email,
      subject: 'Your OTP Code for User Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">OTP Verification Code</h2>
          <p>Your One-Time Password (OTP) for authentication is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${otpCode}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `,
      text: `Your OTP code is: ${otpCode}. This code will expire in 10 minutes.`,
    };

    if (this.isConfigured && this.transporter) {
      try {
        await this.transporter.sendMail(mailOptions);
        console.log(`✓ OTP sent to ${email}`);
      } catch (error: any) {
        // If email fails in production, log the OTP as fallback
        console.error('Failed to send email:', error.message);
        console.log(`\n========================================`);
        console.log(`[FALLBACK] OTP for ${email}: ${otpCode}`);
        console.log(`This OTP will expire in 10 minutes.`);
        console.log(`========================================\n`);
        // In production, you might want to throw here
        if (this.configService.get<string>('NODE_ENV') === 'production') {
          throw new Error(
            `Failed to send OTP email to ${email}: ${error.message}`,
          );
        }
      }
    } else {
      // Development mode - just log the OTP
      console.log(`\n========================================`);
      console.log(`[DEV MODE] OTP for ${email}: ${otpCode}`);
      console.log(`This OTP will expire in 10 minutes.`);
      console.log(`Configure SMTP settings in .env to actually send emails.`);
      console.log(`========================================\n`);
    }
  }

  async sendWelcomeEmail(email: string, name?: string): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        'noreply@userservice.com',
      to: email,
      subject: 'Welcome to User Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome${name ? `, ${name}` : ''}!</h2>
          <p>Thank you for signing up for User Service. Your account has been successfully created.</p>
          <p>You can now log in and start using our services.</p>
        </div>
      `,
    };

    if (this.isConfigured && this.transporter) {
      try {
        await this.transporter.sendMail(mailOptions);
        console.log(`✓ Welcome email sent to ${email}`);
      } catch (error: any) {
        // Welcome email is not critical, just log the error
        if (this.configService.get<string>('NODE_ENV') === 'development') {
          console.log(
            `[DEV MODE] Welcome email failed (non-critical): ${error.message}`,
          );
        } else {
          console.error('Failed to send welcome email:', error);
        }
      }
    } else {
      console.log(`[DEV MODE] Welcome email would be sent to ${email}`);
    }
  }
}
