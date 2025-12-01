import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  Company,
  CompanyDocument,
  CompanyStatus,
} from './schemas/company.schema';
import {
  ApiKey,
  ApiKeyDocument,
  ApiKeyEnvironment,
} from './schemas/api-key.schema';
import {
  Webhook,
  WebhookDocument,
  WebhookEnvironment,
} from './schemas/webhook.schema';
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
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(Webhook.name) private webhookModel: Model<WebhookDocument>,
    private usersService: UsersService,
  ) {}

  async create(
    userId: string,
    createCompanyDto: CreateCompanyDto,
  ): Promise<CompanyDocument> {
    const company = new this.companyModel({
      ...createCompanyDto,
      members: [userId],
      status: CompanyStatus.PENDING,
      onboardingSteps: new Map(),
    });

    const savedCompany = await company.save();

    // Add company to user's companies list
    await this.usersService.addCompanyToUser(
      userId,
      savedCompany._id.toString(),
    );

    // Generate TEST API keys immediately
    await this.generateApiKeys(
      savedCompany._id.toString(),
      ApiKeyEnvironment.TEST,
    );

    return savedCompany;
  }

  async findById(companyId: string): Promise<CompanyDocument | null> {
    return this.companyModel.findById(companyId).populate('members').exec();
  }

  async findUserCompanies(userId: string): Promise<CompanyDocument[]> {
    return this.companyModel.find({ members: userId }).exec();
  }

  async updateOnboardingStep(
    companyId: string,
    step: string,
    completed: boolean,
  ): Promise<CompanyDocument> {
    const company = await this.companyModel.findById(companyId);
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    company.onboardingSteps.set(step, completed);
    await company.save();

    return company;
  }

  async approveCompany(
    companyId: string,
    approvedBy: string,
  ): Promise<CompanyDocument> {
    const company = await this.companyModel.findById(companyId);
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    company.status = CompanyStatus.APPROVED;
    company.approvedAt = new Date();
    company.approvedBy = approvedBy;

    // Generate LIVE API keys after approval
    await this.generateApiKeys(companyId, ApiKeyEnvironment.LIVE);

    return company.save();
  }

  async generateApiKeys(
    companyId: string,
    environment: ApiKeyEnvironment,
  ): Promise<void> {
    // Check if keys already exist
    const existing = await this.apiKeyModel.findOne({
      companyId,
      environment,
      isActive: true,
    });

    if (existing) {
      return; // Keys already exist
    }

    const publicKey = ApiKeyGeneratorUtil.generatePublicKey(environment);
    const secretKey = ApiKeyGeneratorUtil.generateSecretKey(environment);

    // Encrypt and hash secret key
    const encryptedSecret = EncryptionUtil.encrypt(secretKey);
    const secretHash = await bcrypt.hash(secretKey, 12);

    await this.apiKeyModel.create({
      companyId,
      environment,
      publicKey,
      secretKeyHash: secretHash,
      isActive: true,
    });

    // Store encrypted secret for retrieval (in production, use secure key management)
    // For now, we'll need to return it only once during creation
  }

  async getApiKeys(companyId: string, userId: string): Promise<any[]> {
    // Verify user has access
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const keys = await this.apiKeyModel.find({ companyId }).exec();

    return keys.map((key) => ({
      id: key._id.toString(),
      environment: key.environment,
      publicKey: key.publicKey,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      createdAt: (key as any).createdAt,
      // Never return secret keys
    }));
  }

  async revokeApiKey(
    apiKeyId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const apiKey = await this.apiKeyModel.findOne({ _id: apiKeyId, companyId });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    apiKey.isActive = false;
    apiKey.revokedAt = new Date();
    apiKey.revokedBy = userId;
    await apiKey.save();
  }

  // Webhook Management
  async createWebhook(
    companyId: string,
    userId: string,
    createWebhookDto: CreateWebhookDto,
  ): Promise<WebhookDocument> {
    // Verify user has access
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    // Generate webhook secret
    const signingSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    // Encrypt the secret so we can decrypt and use it for signing later
    const signingSecretEncrypted = EncryptionUtil.encrypt(signingSecret);

    const webhook = await this.webhookModel.create({
      companyId,
      environment: createWebhookDto.environment,
      url: createWebhookDto.url,
      signingSecretHash: signingSecretEncrypted, // Store encrypted (we'll rename this field in schema)
      events: createWebhookDto.events || [],
      isActive: true,
    });

    // Return webhook with signing secret (only shown once)
    return {
      ...webhook.toObject(),
      signingSecret, // Only returned on creation
    } as any;
  }

  async getWebhooks(
    companyId: string,
    userId: string,
    environment?: string,
  ): Promise<WebhookDocument[]> {
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const query: any = { companyId };
    if (environment) {
      query.environment = environment;
    }

    return this.webhookModel.find(query).exec();
  }

  async updateWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    updateWebhookDto: UpdateWebhookDto,
  ): Promise<WebhookDocument> {
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookModel.findOne({
      _id: webhookId,
      companyId,
    });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    if (updateWebhookDto.url !== undefined) webhook.url = updateWebhookDto.url;
    if (updateWebhookDto.events !== undefined)
      webhook.events = updateWebhookDto.events;
    if (updateWebhookDto.isActive !== undefined)
      webhook.isActive = updateWebhookDto.isActive;

    return webhook.save();
  }

  async deleteWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
  ): Promise<void> {
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    await this.webhookModel.findOneAndDelete({ _id: webhookId, companyId });
  }

  async testWebhook(
    webhookId: string,
    companyId: string,
    userId: string,
    testDto: TestWebhookDto,
  ): Promise<any> {
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookModel.findOne({
      _id: webhookId,
      companyId,
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
      webhookId: webhook._id.toString(),
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
      await this.webhookModel.findByIdAndUpdate(webhookId, {
        $set: { lastTriggeredAt: new Date() },
        $inc: { successCount: 1 },
      });

      return {
        success: true,
        statusCode: response.status,
        message: 'Webhook triggered successfully',
      };
    } catch (error: any) {
      // Update failure stats
      await this.webhookModel.findByIdAndUpdate(webhookId, {
        $inc: { failureCount: 1 },
      });

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
    const company = await this.companyModel.findById(companyId);
    if (
      !company ||
      !company.members.some((m: any) => m.toString() === userId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    const webhook = await this.webhookModel.findOne({
      _id: webhookId,
      companyId,
    });
    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const newSecret = ApiKeyGeneratorUtil.generateWebhookSecret();
    const signingSecretEncrypted = EncryptionUtil.encrypt(newSecret);

    webhook.signingSecretHash = signingSecretEncrypted;
    await webhook.save();

    return newSecret; // Return once for user to save
  }
}
