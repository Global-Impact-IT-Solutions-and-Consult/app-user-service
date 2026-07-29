import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export class EncryptionUtil {
  private static getKey(): Buffer {
    // Read at call time so Nest ConfigModule / dotenv can populate process.env first
    const raw =
      process.env.ENCRYPTION_KEY ||
      'dev-only-change-me-32chars-min!!';
    return crypto.createHash('sha256').update(raw).digest();
  }

  static encrypt(text: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  static decrypt(encryptedText: string): string {
    const key = this.getKey();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
