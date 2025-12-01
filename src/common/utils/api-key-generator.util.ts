import * as crypto from 'crypto';

export class ApiKeyGeneratorUtil {
  private static readonly PREFIX_TEST = 'pk_test_';
  private static readonly PREFIX_LIVE = 'pk_live_';
  private static readonly SECRET_PREFIX_TEST = 'sk_test_';
  private static readonly SECRET_PREFIX_LIVE = 'sk_live_';
  private static readonly KEY_LENGTH = 32;

  static generatePublicKey(environment: 'test' | 'live'): string {
    const prefix = environment === 'test' ? this.PREFIX_TEST : this.PREFIX_LIVE;
    const randomBytes = crypto.randomBytes(this.KEY_LENGTH).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    return `${prefix}${randomBytes.substring(0, this.KEY_LENGTH)}`;
  }

  static generateSecretKey(environment: 'test' | 'live'): string {
    const prefix = environment === 'test' ? this.SECRET_PREFIX_TEST : this.SECRET_PREFIX_LIVE;
    const randomBytes = crypto.randomBytes(this.KEY_LENGTH * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    return `${prefix}${randomBytes.substring(0, this.KEY_LENGTH * 2)}`;
  }

  static generateWebhookSecret(): string {
    return `whsec_${crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`;
  }
}

