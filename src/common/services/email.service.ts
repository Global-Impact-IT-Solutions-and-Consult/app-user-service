import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    // Create transporter based on environment
    const emailConfig = {
      host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: parseInt(this.configService.get<string>('SMTP_PORT') || '587'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true', // true for 465, false for other ports
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    };

    // If no SMTP config, use test account (for development)
    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      console.warn('SMTP not configured. Email sending will be disabled.');
      // Create a test transporter (won't actually send emails)
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'test@example.com',
          pass: 'test',
        },
      });
    } else {
      this.transporter = nodemailer.createTransport(emailConfig);
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

    try {
      if (
        this.configService.get<string>('SMTP_USER') &&
        this.configService.get<string>('SMTP_PASS')
      ) {
        await this.transporter.sendMail(mailOptions);
        console.log(`OTP sent to ${email}`);
      } else {
        console.log(`[DEV MODE] OTP for ${email}: ${otpCode}`);
        console.log('Configure SMTP settings to actually send emails.');
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      throw new Error('Failed to send OTP email');
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

    try {
      if (
        this.configService.get<string>('SMTP_USER') &&
        this.configService.get<string>('SMTP_PASS')
      ) {
        await this.transporter.sendMail(mailOptions);
      } else {
        console.log(`[DEV MODE] Welcome email would be sent to ${email}`);
      }
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      // Don't throw - welcome email is not critical
    }
  }
}
