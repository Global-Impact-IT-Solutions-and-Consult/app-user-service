export class OtpGeneratorUtil {
  /**
   * Generate a 6-digit OTP code
   */
  static generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate OTP expiration time (default: 10 minutes)
   */
  static generateOTPExpiration(minutes: number = 10): Date {
    const expiration = new Date();
    expiration.setMinutes(expiration.getMinutes() + minutes);
    return expiration;
  }

  /**
   * Check if OTP is expired
   */
  static isOTPExpired(expiresAt: Date): boolean {
    return new Date() > expiresAt;
  }
}
