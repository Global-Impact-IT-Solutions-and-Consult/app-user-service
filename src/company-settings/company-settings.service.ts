import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CompanySettings } from '../companies/entities/company-settings.entity';
import { Settings, SettingsType } from '../companies/entities/settings.entity';
import { Webhook } from '../companies/entities/webhook.entity';
import { WebhookEvent } from '../companies/entities/webhook-event.entity';
import { Company } from '../companies/entities/company.entity';
import { ApiKeyGeneratorUtil } from '../common/utils/api-key-generator.util';
import { EncryptionUtil } from '../common/utils/encryption.util';
import * as bcrypt from 'bcrypt';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class CompanySettingsService {
  private readonly logger = new Logger(CompanySettingsService.name);

  constructor(
    @InjectRepository(CompanySettings)
    private companySettingsRepository: Repository<CompanySettings>,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
    @InjectRepository(Webhook)
    private webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookEvent)
    private webhookEventRepository: Repository<WebhookEvent>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private dataSource: DataSource,
    private loggingService: LoggingService,
  ) {}

  /**
   * Create CompanySettings with two Settings (LIVE and TEST) when a company is created
   */
  async createCompanySettings(companyId: string): Promise<CompanySettings> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check if company exists
      const company = await queryRunner.manager.findOne(Company, {
        where: { id: companyId },
      });
      if (!company) {
        throw new NotFoundException('Company not found');
      }

      // Check if CompanySettings already exists
      const existing = await queryRunner.manager.findOne(CompanySettings, {
        where: { companyId },
      });
      if (existing) {
        throw new BadRequestException(
          'Company settings already exist for this company',
        );
      }

      // Create CompanySettings
      const companySettings = queryRunner.manager.create(CompanySettings, {
        companyId,
        mfaRequired: false,
      });
      const savedCompanySettings = await queryRunner.manager.save(
        CompanySettings,
        companySettings,
      );

      // Create two Settings: TEST and LIVE
      const testSettings = queryRunner.manager.create(Settings, {
        companySettingsId: savedCompanySettings.id,
        type: SettingsType.TEST,
        isActive: true,
      });

      const liveSettings = queryRunner.manager.create(Settings, {
        companySettingsId: savedCompanySettings.id,
        type: SettingsType.LIVE,
        isActive: false, // Not active until company is approved
      });

      const [savedTestSettings, savedLiveSettings] =
        await queryRunner.manager.save(Settings, [testSettings, liveSettings]);

      // Generate API keys for TEST settings
      await this.generateApiKeysForSettings(
        queryRunner,
        savedTestSettings.id,
        SettingsType.TEST,
      );

      // Commit transaction
      await queryRunner.commitTransaction();

      // Reload with relations
      const reloaded = await this.companySettingsRepository.findOne({
        where: { id: savedCompanySettings.id },
        relations: ['settings'],
      });
      if (!reloaded) {
        throw new InternalServerErrorException(
          'Failed to reload company settings',
        );
      }
      return reloaded;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to create company settings: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Generate API keys for a Settings entity
   */
  private async generateApiKeysForSettings(
    queryRunner: any,
    settingsId: string,
    type: SettingsType,
  ): Promise<void> {
    const settings = await queryRunner.manager.findOne(Settings, {
      where: { id: settingsId },
    });

    if (!settings || settings.publicKey) {
      return; // Keys already exist
    }

    const publicKey = ApiKeyGeneratorUtil.generatePublicKey(type);
    const secretKey = ApiKeyGeneratorUtil.generateSecretKey(type);

    // Encrypt and hash secret key
    const encryptedSecret = EncryptionUtil.encrypt(secretKey);
    const secretHash = await bcrypt.hash(secretKey, 12);

    settings.publicKey = publicKey;
    settings.secretKeyHash = secretHash;
    settings.isActive = true;

    await queryRunner.manager.save(Settings, settings);
  }

  /**
   * Get CompanySettings for a company
   */
  async getCompanySettings(
    companyId: string,
    userId: string,
  ): Promise<CompanySettings> {
    // Verify user has access
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });

    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const companySettings = await this.companySettingsRepository.findOne({
      where: { companyId },
      relations: ['settings', 'settings.webhooks'],
    });

    if (!companySettings) {
      throw new NotFoundException('Company settings not found');
    }

    return companySettings;
  }

  /**
   * Update MFA requirement for company
   */
  async updateMfaRequirement(
    companyId: string,
    userId: string,
    mfaRequired: boolean,
  ): Promise<CompanySettings> {
    const companySettings = await this.getCompanySettings(companyId, userId);

    companySettings.mfaRequired = mfaRequired;
    const saved = await this.companySettingsRepository.save(companySettings);

    // Log MFA requirement update
    try {
      await this.loggingService.createLog({
        companyId,
        environment: 'test', // MFA requirement applies to both environments
        eventType: 'company.mfa_requirement.updated',
        message: `MFA requirement ${mfaRequired ? 'enabled' : 'disabled'} for company`,
        level: 'info',
        metadata: { userId, mfaRequired },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return saved;
  }

  /**
   * Get Settings by type for a company
   */
  async getSettingsByType(
    companyId: string,
    userId: string,
    type: SettingsType,
  ): Promise<Settings> {
    const companySettings = await this.getCompanySettings(companyId, userId);

    const settings = companySettings.settings.find((s) => s.type === type);
    if (!settings) {
      throw new NotFoundException(`Settings for type ${type} not found`);
    }

    const reloaded = await this.settingsRepository.findOne({
      where: { id: settings.id },
      relations: ['webhooks'],
    });
    if (!reloaded) {
      throw new NotFoundException(`Settings for type ${type} not found`);
    }
    return reloaded;
  }

  /**
   * Generate API keys for a specific Settings (regenerate)
   */
  async regenerateApiKeys(
    companyId: string,
    userId: string,
    settingsType: SettingsType,
  ): Promise<{ publicKey: string; secretKey: string }> {
    const settings = await this.getSettingsByType(
      companyId,
      userId,
      settingsType,
    );

    const publicKey = ApiKeyGeneratorUtil.generatePublicKey(settingsType);
    const secretKey = ApiKeyGeneratorUtil.generateSecretKey(settingsType);

    const secretHash = await bcrypt.hash(secretKey, 12);

    settings.publicKey = publicKey;
    settings.secretKeyHash = secretHash;
    settings.revokedAt = null;
    settings.revokedBy = null;
    settings.isActive = true;

    await this.settingsRepository.save(settings);

    return { publicKey, secretKey };
  }

  /**
   * Revoke API keys for a specific Settings
   */
  async revokeApiKeys(
    companyId: string,
    userId: string,
    settingsType: SettingsType,
  ): Promise<void> {
    const settings = await this.getSettingsByType(
      companyId,
      userId,
      settingsType,
    );

    settings.isActive = false;
    settings.revokedAt = new Date();
    settings.revokedBy = userId;

    await this.settingsRepository.save(settings);
  }

  /**
   * Create a webhook for a specific Settings
   */
  async createWebhook(
    companyId: string,
    userId: string,
    settingsType: SettingsType,
    url: string,
    subscribedEvents: string[],
  ): Promise<{ webhook: Webhook; signingSecret: string }> {
    const settings = await this.getSettingsByType(
      companyId,
      userId,
      settingsType,
    );

    const signingSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    const signingSecretEncrypted = EncryptionUtil.encrypt(signingSecret);

    const webhook = this.webhookRepository.create({
      settingsId: settings.id,
      companyId,
      url,
      signingSecretHash: signingSecretEncrypted,
      subscribedEvents: subscribedEvents || [],
      isActive: true,
    });

    const savedWebhook = await this.webhookRepository.save(webhook);

    return {
      webhook: savedWebhook,
      signingSecret,
    };
  }

  /**
   * Get webhooks for a company
   */
  async getWebhooks(
    companyId: string,
    userId: string,
    settingsType?: SettingsType,
  ): Promise<Webhook[]> {
    const companySettings = await this.getCompanySettings(companyId, userId);

    if (settingsType) {
      const settings = companySettings.settings.find(
        (s) => s.type === settingsType,
      );
      if (!settings) {
        return [];
      }
      return this.webhookRepository.find({
        where: { settingsId: settings.id },
      });
    }

    // Get all webhooks for all settings
    const allWebhooks: Webhook[] = [];
    for (const settings of companySettings.settings) {
      const webhooks = await this.webhookRepository.find({
        where: { settingsId: settings.id },
      });
      allWebhooks.push(...webhooks);
    }

    return allWebhooks;
  }

  /**
   * Update a webhook
   */
  async updateWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    url?: string,
    subscribedEvents?: string[],
    isActive?: boolean,
  ): Promise<Webhook> {
    await this.getCompanySettings(companyId, userId); // Verify access

    const webhook = await this.webhookRepository.findOne({
      where: { id: webhookId, companyId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    if (url !== undefined) webhook.url = url;
    if (subscribedEvents !== undefined)
      webhook.subscribedEvents = subscribedEvents;
    if (isActive !== undefined) webhook.isActive = isActive;

    return this.webhookRepository.save(webhook);
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    await this.getCompanySettings(companyId, userId); // Verify access

    const webhook = await this.webhookRepository.findOne({
      where: { id: webhookId, companyId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    await this.webhookRepository.remove(webhook);
  }

  /**
   * Get webhook by ID
   */
  async getWebhookById(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<Webhook> {
    await this.getCompanySettings(companyId, userId); // Verify access

    const webhook = await this.webhookRepository.findOne({
      where: { id: webhookId, companyId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    return webhook;
  }

  /**
   * Regenerate webhook secret
   */
  async regenerateWebhookSecret(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<string> {
    const webhook = await this.getWebhookById(webhookId, companyId, userId);

    const newSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    const signingSecretEncrypted = EncryptionUtil.encrypt(newSecret);

    webhook.signingSecretHash = signingSecretEncrypted;
    await this.webhookRepository.save(webhook);

    return newSecret;
  }

  /**
   * Update webhook stats after test/trigger
   */
  async updateWebhookStats(
    webhookId: string,
    success: boolean,
  ): Promise<void> {
    const webhook = await this.webhookRepository.findOne({
      where: { id: webhookId },
    });

    if (!webhook) {
      return;
    }

    webhook.lastTriggeredAt = new Date();
    if (success) {
      webhook.successCount = (webhook.successCount || 0) + 1;
    } else {
      webhook.failureCount = (webhook.failureCount || 0) + 1;
    }

    await this.webhookRepository.save(webhook);
  }
}

