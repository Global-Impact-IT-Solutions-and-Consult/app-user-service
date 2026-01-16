import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Company, CompanyStatus } from './entities/company.entity';
import { User } from '../users/entities/user.entity';
import { Webhook } from './entities/webhook.entity';
import { CompanySettingsService } from '../company-settings/company-settings.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  TestWebhookDto,
} from './dto/webhook.dto';
import { EncryptionUtil } from '../common/utils/encryption.util';
import { UsersService } from '../users/users.service';
import axios from 'axios';
import { SettingsType } from './entities/settings.entity';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private usersService: UsersService,
    private companySettingsService: CompanySettingsService,
    private loggingService: LoggingService,
  ) {}

  async create(
    userId: string,
    createCompanyDto: CreateCompanyDto,
  ): Promise<Company> {
    const queryRunner = this.companyRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create company without members first to ensure it gets an ID
      const company = queryRunner.manager.create(Company, {
        ...createCompanyDto,
        status: CompanyStatus.PENDING,
        onboardingSteps: {},
      });

      // Save company to get the generated ID
      const savedCompany = await queryRunner.manager.save(Company, company);

      // Verify the company was saved and has an ID
      if (!savedCompany.id) {
        throw new InternalServerErrorException(
          'Company was created but did not receive an ID',
        );
      }

      this.logger.debug(
        `Company created with ID: ${savedCompany.id}, User ID: ${user.id}`,
      );

      // Use TypeORM's relation manager to add the user to the company
      // This ensures the relationship is created properly within the transaction
      await queryRunner.manager
        .createQueryBuilder()
        .relation(Company, 'members')
        .of(savedCompany.id)
        .add(user.id);

      // Commit transaction first
      await queryRunner.commitTransaction();

      // Create CompanySettings with TEST and LIVE settings (outside transaction)
      await this.companySettingsService.createCompanySettings(savedCompany.id);

      // Reload company with relations for return
      const companyWithRelations = await this.companyRepository.findOne({
        where: { id: savedCompany.id },
        relations: ['members', 'companySettings', 'companySettings.settings'],
      });

      // Log company creation
      try {
        await this.loggingService.createLog({
          companyId: savedCompany.id,
          environment: 'test',
          eventType: 'company.created',
          message: `Company "${savedCompany.name}" created`,
          level: 'info',
          metadata: { userId, companyName: savedCompany.name, companyId: savedCompany.id },
        });
      } catch (error) {
        // Don't fail if logging fails
      }

      return companyWithRelations || savedCompany;
    } catch (error: any) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      
      this.logger.error(
        `Failed to create company for user ${userId}: ${error.message}`,
        error.stack,
      );

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      // Handle foreign key constraint violations
      if (error.code === '23503') {
        throw new BadRequestException(
          `Database constraint violation: ${error.detail || error.message}`,
        );
      }

      // Handle other database errors
      if (error.code && error.code.startsWith('23')) {
        throw new BadRequestException(
          `Database error: ${error.detail || error.message}`,
        );
      }

      // Generic error
      throw new InternalServerErrorException(
        `Failed to create company: ${error.message || 'Unknown error'}`,
      );
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }

  async findById(companyId: string): Promise<Company | null> {
    return this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
  }

  async findUserCompanies(userId: string): Promise<Company[]> {
    return this.companyRepository
      .createQueryBuilder('company')
      .innerJoin('company.members', 'user')
      .where('user.id = :userId', { userId })
      .getMany();
  }

  async updateOnboardingStep(
    companyId: string,
    step: string,
    completed: boolean,
  ): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    company.onboardingSteps = {
      ...(company.onboardingSteps || {}),
      [step]: completed,
    };
    const savedCompany = await this.companyRepository.save(company);

    // Log onboarding step update
    try {
      const user = await this.userRepository.findOne({ where: { id: companyId } });
      const environment = user?.currentEnvironment || 'test';
      await this.loggingService.createLog({
        companyId,
        environment,
        eventType: 'company.onboarding_step.updated',
        message: `Onboarding step "${step}" ${completed ? 'completed' : 'reverted'}`,
        level: 'info',
        metadata: { step, completed },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return savedCompany;
  }

  async approveCompany(
    companyId: string,
    approvedBy: string,
  ): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    company.status = CompanyStatus.APPROVED;
    company.approvedAt = new Date();
    company.approvedBy = approvedBy;

    // Activate LIVE settings after approval (API keys already generated)
    const companySettings = await this.companySettingsService.getCompanySettings(
      companyId,
      approvedBy,
    );
    const liveSettings = companySettings.settings.find(
      (s) => s.type === SettingsType.LIVE,
    );
    if (liveSettings && !liveSettings.publicKey) {
      // Generate LIVE API keys if not already generated
      await this.companySettingsService.regenerateApiKeys(
        companyId,
        approvedBy,
        SettingsType.LIVE,
      );
    }

    return this.companyRepository.save(company);
  }


  async getApiKeys(companyId: string, userId: string): Promise<any[]> {
    const companySettings = await this.companySettingsService.getCompanySettings(
      companyId,
      userId,
    );

    return companySettings.settings.map((settings) => ({
      id: settings.id,
      type: settings.type,
      publicKey: settings.publicKey,
      isActive: settings.isActive,
      lastUsedAt: settings.lastUsedAt,
      createdAt: settings.createdAt,
    }));
  }

  async revokeApiKey(
    settingsId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    // Use CompanySettingsService to revoke
    const companySettings = await this.companySettingsService.getCompanySettings(
      companyId,
      userId,
    );
    const settings = companySettings.settings.find((s) => s.id === settingsId);
    if (!settings) {
      throw new NotFoundException('Settings not found');
    }

    await this.companySettingsService.revokeApiKeys(
      companyId,
      userId,
      settings.type,
    );

    // Log API key revocation
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const environment = settings.type === SettingsType.LIVE ? 'live' : 'test';
      await this.loggingService.createLog({
        companyId,
        environment,
        eventType: 'api-key.revoked',
        message: `API key revoked for ${settings.type} environment`,
        level: 'warning',
        metadata: { userId, settingsId, environment: settings.type },
      });
    } catch (error) {
      // Don't fail if logging fails
    }
  }

  async regenerateApiKeys(
    companyId: string,
    userId: string,
    environment: SettingsType,
  ): Promise<{ publicKey: string; secretKey: string; environment: SettingsType }> {
    // Verify user has access to company
    await this.companySettingsService.getCompanySettings(companyId, userId);

    // Regenerate API keys using CompanySettingsService
    const { publicKey, secretKey } =
      await this.companySettingsService.regenerateApiKeys(
        companyId,
        userId,
        environment,
      );

    // Log API key regeneration
    try {
      const env = environment === SettingsType.LIVE ? 'live' : 'test';
      await this.loggingService.createLog({
        companyId,
        environment: env,
        eventType: 'api-key.regenerated',
        message: `API keys regenerated for ${environment} environment`,
        level: 'info',
        metadata: { userId, environment },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return { publicKey, secretKey, environment };
  }

  // Webhook Management - Delegated to CompanySettingsService
  async createWebhook(
    companyId: string,
    userId: string,
    createWebhookDto: CreateWebhookDto,
  ): Promise<any> {
    const result = await this.companySettingsService.createWebhook(
      companyId,
      userId,
      createWebhookDto.environment,
      createWebhookDto.url,
      createWebhookDto.events || [],
    );

    // Log webhook creation
    try {
      await this.loggingService.createLog({
        companyId,
        environment: createWebhookDto.environment,
        eventType: 'webhook.created',
        message: `Webhook created: ${createWebhookDto.url}`,
        level: 'info',
        metadata: { userId, webhookId: result.webhook.id, url: createWebhookDto.url, events: createWebhookDto.events },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return {
      ...result.webhook,
      signingSecret: result.signingSecret,
    };
  }

  async getWebhooks(
    companyId: string,
    userId: string,
    environment?: string,
  ): Promise<Webhook[]> {
    const settingsType = environment
      ? (environment === 'test' ? SettingsType.TEST : SettingsType.LIVE)
      : undefined;
    return this.companySettingsService.getWebhooks(
      companyId,
      userId,
      settingsType,
    );
  }

  async updateWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    updateWebhookDto: UpdateWebhookDto,
  ): Promise<Webhook> {
    const webhook = await this.companySettingsService.updateWebhook(
      webhookId,
      companyId,
      userId,
      updateWebhookDto.url,
      updateWebhookDto.events,
      updateWebhookDto.isActive,
    );

    // Log webhook update
    try {
      await this.loggingService.createLog({
        companyId,
        environment: webhook.settings.type === SettingsType.LIVE ? 'live' : 'test',
        eventType: 'webhook.updated',
        message: `Webhook updated: ${webhook.url}`,
        level: 'info',
        metadata: { userId, webhookId, url: webhook.url, isActive: webhook.isActive },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return webhook;
  }

  async deleteWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    // Get webhook before deleting for logging
    const webhook = await this.companySettingsService.getWebhookById(
      webhookId,
      companyId,
      userId,
    );

    await this.companySettingsService.deleteWebhook(
      webhookId,
      companyId,
      userId,
    );

    // Log webhook deletion
    try {
      await this.loggingService.createLog({
        companyId,
        environment: webhook.settings.type === SettingsType.LIVE ? 'live' : 'test',
        eventType: 'webhook.deleted',
        message: `Webhook deleted: ${webhook.url}`,
        level: 'warning',
        metadata: { userId, webhookId, url: webhook.url },
      });
    } catch (error) {
      // Don't fail if logging fails
    }
  }

  async testWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    testDto: TestWebhookDto,
  ): Promise<any> {
    const webhook = await this.companySettingsService.getWebhookById(
      webhookId,
      companyId,
      userId,
    );

    if (!webhook.isActive) {
      throw new BadRequestException('Webhook is not active');
    }

    // Create test payload
    const payload = {
      event: testDto.eventType,
      data: testDto.payload || {},
      timestamp: new Date().toISOString(),
      webhookId: webhook.id,
    };

    // Decrypt the signing secret
    const signingSecret = EncryptionUtil.decrypt(webhook.signingSecretHash);

    // Generate signature (HMAC SHA256)
    const signature = crypto
      .createHmac('sha256', signingSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': testDto.eventType,
        },
        timeout: 10000,
      });

      // Update webhook stats
      await this.companySettingsService.updateWebhookStats(webhookId, true);

      // Log successful webhook test
      try {
        await this.loggingService.createLog({
          companyId,
          environment: webhook.settings.type === SettingsType.LIVE ? 'live' : 'test',
          eventType: 'webhook.tested',
          message: `Webhook test successful: ${webhook.url}`,
          level: 'info',
          metadata: { userId, webhookId, eventType: testDto.eventType, statusCode: response.status },
        });
      } catch (error) {
        // Don't fail if logging fails
      }

      return {
        success: true,
        statusCode: response.status,
        message: 'Webhook triggered successfully',
      };
    } catch (error: any) {
      // Update failure stats
      await this.companySettingsService.updateWebhookStats(webhookId, false);

      // Log failed webhook test
      try {
        await this.loggingService.createLog({
          companyId,
          environment: webhook.settings.type === SettingsType.LIVE ? 'live' : 'test',
          eventType: 'webhook.test.failed',
          message: `Webhook test failed: ${webhook.url}`,
          level: 'error',
          metadata: { userId, webhookId, eventType: testDto.eventType, error: error.message },
        });
      } catch (logError) {
        // Don't fail if logging fails
      }

      return {
        success: false,
        error: error.message,
        statusCode: error.response?.status,
      };
    }
  }

  async regenerateWebhookSecret(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<string> {
    const webhook = await this.companySettingsService.getWebhookById(
      webhookId,
      companyId,
      userId,
    );

    const secret = await this.companySettingsService.regenerateWebhookSecret(
      webhookId,
      companyId,
      userId,
    );

    // Log webhook secret regeneration
    try {
      await this.loggingService.createLog({
        companyId,
        environment: webhook.settings.type === SettingsType.LIVE ? 'live' : 'test',
        eventType: 'webhook.secret.regenerated',
        message: `Webhook signing secret regenerated: ${webhook.url}`,
        level: 'warning',
        metadata: { userId, webhookId, url: webhook.url },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return secret;
  }
}
