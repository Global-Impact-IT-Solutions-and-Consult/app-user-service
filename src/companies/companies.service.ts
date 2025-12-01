import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Company, CompanyStatus } from './entities/company.entity';
import { ApiKey, ApiKeyEnvironment } from './entities/api-key.entity';
import { Webhook, WebhookEnvironment } from './entities/webhook.entity';
import { User } from '../users/entities/user.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  TestWebhookDto,
} from './dto/webhook.dto';
import { EncryptionUtil } from '../common/utils/encryption.util';
import { ApiKeyGeneratorUtil } from '../common/utils/api-key-generator.util';
import { UsersService } from '../users/users.service';
import axios from 'axios';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    @InjectRepository(ApiKey)
    private apiKeyRepository: Repository<ApiKey>,
    @InjectRepository(Webhook)
    private webhookRepository: Repository<Webhook>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private usersService: UsersService,
  ) {}

  async create(
    userId: string,
    createCompanyDto: CreateCompanyDto,
  ): Promise<Company> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const company = this.companyRepository.create({
      ...createCompanyDto,
      members: [user],
      status: CompanyStatus.PENDING,
      onboardingSteps: {},
    });

    const savedCompany = await this.companyRepository.save(company);

    // Add company to user's companies list
    user.companies = [...(user.companies || []), savedCompany];
    await this.userRepository.save(user);

    // Generate TEST API keys immediately
    await this.generateApiKeys(savedCompany.id, ApiKeyEnvironment.TEST);

    return savedCompany;
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
    return this.companyRepository.save(company);
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

    // Generate LIVE API keys after approval
    await this.generateApiKeys(companyId, ApiKeyEnvironment.LIVE);

    return this.companyRepository.save(company);
  }

  async generateApiKeys(
    companyId: string,
    environment: ApiKeyEnvironment,
  ): Promise<void> {
    // Check if keys already exist
    const existing = await this.apiKeyRepository.findOne({
      where: {
        companyId,
        environment,
        isActive: true,
      },
    });

    if (existing) {
      return; // Keys already exist
    }

    const publicKey = ApiKeyGeneratorUtil.generatePublicKey(environment);
    const secretKey = ApiKeyGeneratorUtil.generateSecretKey(environment);

    // Encrypt and hash secret key
    const encryptedSecret = EncryptionUtil.encrypt(secretKey);
    const secretHash = await bcrypt.hash(secretKey, 12);

    await this.apiKeyRepository.save({
      companyId,
      environment,
      publicKey,
      secretKeyHash: secretHash,
      isActive: true,
    });
  }

  async getApiKeys(companyId: string, userId: string): Promise<any[]> {
    // Verify user has access
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const keys = await this.apiKeyRepository.find({
      where: { companyId },
    });

    return keys.map((key) => ({
      id: key.id,
      environment: key.environment,
      publicKey: key.publicKey,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
    }));
  }

  async revokeApiKey(
    apiKeyId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: apiKeyId, companyId },
    });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    apiKey.isActive = false;
    apiKey.revokedAt = new Date();
    apiKey.revokedBy = userId;
    await this.apiKeyRepository.save(apiKey);
  }

  // Webhook Management
  async createWebhook(
    companyId: string,
    userId: string,
    createWebhookDto: CreateWebhookDto,
  ): Promise<any> {
    // Verify user has access
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    // Generate webhook secret
    const signingSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    // Encrypt the secret so we can decrypt and use it for signing later
    const signingSecretEncrypted = EncryptionUtil.encrypt(signingSecret);

    const webhook = this.webhookRepository.create({
      companyId,
      environment: createWebhookDto.environment,
      url: createWebhookDto.url,
      signingSecretHash: signingSecretEncrypted,
      events: createWebhookDto.events || [],
      isActive: true,
    });

    const savedWebhook = await this.webhookRepository.save(webhook);

    // Return webhook with signing secret (only shown once)
    return {
      ...savedWebhook,
      signingSecret, // Only returned on creation
    };
  }

  async getWebhooks(
    companyId: string,
    userId: string,
    environment?: string,
  ): Promise<Webhook[]> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const where: any = { companyId };
    if (environment) {
      where.environment = environment;
    }

    return this.webhookRepository.find({ where });
  }

  async updateWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    updateWebhookDto: UpdateWebhookDto,
  ): Promise<Webhook> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookRepository.findOne({
      where: {
        id: webhookId,
        companyId,
      },
    });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    if (updateWebhookDto.url !== undefined) webhook.url = updateWebhookDto.url;
    if (updateWebhookDto.events !== undefined)
      webhook.events = updateWebhookDto.events;
    if (updateWebhookDto.isActive !== undefined)
      webhook.isActive = updateWebhookDto.isActive;

    return this.webhookRepository.save(webhook);
  }

  async deleteWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    await this.webhookRepository.delete({ id: webhookId, companyId });
  }

  async testWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    testDto: TestWebhookDto,
  ): Promise<any> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookRepository.findOne({
      where: {
        id: webhookId,
        companyId,
      },
    });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

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
      webhook.lastTriggeredAt = new Date();
      webhook.successCount = (webhook.successCount || 0) + 1;
      await this.webhookRepository.save(webhook);

      return {
        success: true,
        statusCode: response.status,
        message: 'Webhook triggered successfully',
      };
    } catch (error: any) {
      // Update failure stats
      webhook.failureCount = (webhook.failureCount || 0) + 1;
      await this.webhookRepository.save(webhook);

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
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company || !company.members.some((m) => m.id === userId)) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookRepository.findOne({
      where: {
        id: webhookId,
        companyId,
      },
    });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const newSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    const signingSecretEncrypted = EncryptionUtil.encrypt(newSecret);

    webhook.signingSecretHash = signingSecretEncrypted;
    await this.webhookRepository.save(webhook);

    return newSecret; // Return once for user to save
  }
}
