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
import { UpdateCompanyDto } from './dto/update-company.dto';
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
import { EmailService } from '../common/services/email.service';
import { ConfigService } from '@nestjs/config';
import {
  CompanyInvite,
  CompanyInviteStatus,
} from './entities/company-invite.entity';
import { InviteMemberDto } from './dto/invite-member.dto';
import { DeleteCompanyDto } from './dto/delete-company.dto';
import { AcceptInviteDto } from '../auth/dto/accept-invite.dto';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CompanyInvite)
    private inviteRepository: Repository<CompanyInvite>,
    private usersService: UsersService,
    private companySettingsService: CompanySettingsService,
    private loggingService: LoggingService,
    private emailService: EmailService,
    private configService: ConfigService,
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

  async update(
    companyId: string,
    userId: string,
    updateCompanyDto: UpdateCompanyDto,
  ): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const isMember = company.members?.some((member) => member.id === userId);
    if (!isMember) {
      throw new ForbiddenException('You do not have access to this company');
    }

    Object.assign(company, updateCompanyDto);
    const savedCompany = await this.companyRepository.save(company);

    try {
      await this.loggingService.createLog({
        companyId,
        environment: 'test',
        eventType: 'company.profile.updated',
        message: `Company "${savedCompany.name}" profile updated`,
        level: 'info',
        metadata: { userId, companyId },
      });
    } catch (error) {
      // Don't fail if logging fails
    }

    return savedCompany;
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

  async listMembers(companyId: string, userId: string) {
    const company = await this.requireMember(companyId, userId);
    return (company.members || []).map((member) => ({
      id: member.id,
      email: member.email,
      roles: member.roles || [],
      isActive: member.isActive,
      lastLoginAt: member.lastLoginAt,
      isCurrentUser: member.id === userId,
    }));
  }

  async inviteMember(
    companyId: string,
    userId: string,
    dto: InviteMemberDto,
  ) {
    const company = await this.requireMember(companyId, userId);
    const email = dto.email.toLowerCase();
    const role = dto.role || 'member';

    const alreadyMember = company.members?.some(
      (member) => member.email.toLowerCase() === email,
    );
    if (alreadyMember) {
      throw new BadRequestException('User is already a member of this company');
    }

    await this.inviteRepository.update(
      {
        companyId,
        email,
        status: CompanyInviteStatus.PENDING,
      },
      { status: CompanyInviteStatus.REVOKED },
    );

    const token = crypto.randomBytes(32).toString('hex');
    const invite = this.inviteRepository.create({
      companyId,
      email,
      role,
      tokenHash: this.hashToken(token),
      invitedBy: userId,
      status: CompanyInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const saved = await this.inviteRepository.save(invite);

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';
    const inviteUrl = `${frontendUrl.replace(/\/$/, '')}/accept-invite?token=${token}`;
    await this.emailService.sendTeamInviteEmail(email, company.name, inviteUrl);

    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      console.log(`\n========================================`);
      console.log(`[INVITE] Company: ${company.name}`);
      console.log(`[INVITE] Email: ${email}`);
      console.log(`[INVITE] Token: ${token}`);
      console.log(`========================================\n`);
    }

    await this.loggingService.safeCreateLog({
      companyId,
      environment: 'test',
      eventType: 'company.member.invited',
      message: `Invited ${email} to ${company.name}`,
      level: 'info',
      metadata: { userId, email, role, inviteId: saved.id },
    });

    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      status: saved.status,
      expiresAt: saved.expiresAt,
      message: 'Invite sent',
    };
  }

  async listInvites(companyId: string, userId: string) {
    await this.requireMember(companyId, userId);
    const invites = await this.inviteRepository.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
    return invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      createdAt: invite.createdAt,
    }));
  }

  async revokeInvite(companyId: string, userId: string, inviteId: string) {
    await this.requireMember(companyId, userId);
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, companyId },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    invite.status = CompanyInviteStatus.REVOKED;
    await this.inviteRepository.save(invite);
    return { message: 'Invite revoked' };
  }

  async removeMember(companyId: string, actorId: string, memberId: string) {
    const company = await this.requireMember(companyId, actorId);
    if (memberId === actorId) {
      throw new BadRequestException('You cannot remove yourself from the company');
    }
    const member = company.members?.find((m) => m.id === memberId);
    if (!member) {
      throw new NotFoundException('Member not found in this company');
    }
    if ((company.members || []).length <= 1) {
      throw new BadRequestException('Cannot remove the last company member');
    }

    await this.companyRepository
      .createQueryBuilder()
      .relation(Company, 'members')
      .of(companyId)
      .remove(memberId);

    if (member.currentCompanyId === companyId) {
      await this.userRepository.update(memberId, { currentCompanyId: null });
    }

    await this.loggingService.safeCreateLog({
      companyId,
      environment: 'test',
      eventType: 'company.member.removed',
      message: `Removed ${member.email} from ${company.name}`,
      level: 'warning',
      metadata: { userId: actorId, removedUserId: memberId },
    });

    return { message: 'Member removed' };
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.inviteRepository.findOne({
      where: { tokenHash: this.hashToken(dto.token) },
      relations: ['company', 'company.members'],
    });
    if (
      !invite ||
      invite.status !== CompanyInviteStatus.PENDING ||
      invite.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired invite');
    }

    let user = await this.userRepository.findOne({
      where: { email: invite.email },
      relations: ['companies'],
    });

    if (!user) {
      if (!dto.password) {
        throw new BadRequestException(
          'Password is required to create an account for this invite',
        );
      }
      const passwordHash = await bcrypt.hash(dto.password, 12);
      user = this.userRepository.create({
        email: invite.email,
        passwordHash,
        isEmailVerified: true,
        mfaEnabled: false,
        roles: [invite.role],
        currentCompanyId: invite.companyId,
      });
      user = await this.userRepository.save(user);
    } else {
      const roles = new Set([...(user.roles || []), invite.role]);
      user.roles = [...roles];
      if (!user.currentCompanyId) {
        user.currentCompanyId = invite.companyId;
      }
      await this.userRepository.save(user);
    }

    const already = invite.company.members?.some((m) => m.id === user.id);
    if (!already) {
      await this.companyRepository
        .createQueryBuilder()
        .relation(Company, 'members')
        .of(invite.companyId)
        .add(user.id);
    }

    invite.status = CompanyInviteStatus.ACCEPTED;
    invite.acceptedAt = new Date();
    await this.inviteRepository.save(invite);

    await this.loggingService.safeCreateLog({
      companyId: invite.companyId,
      environment: 'test',
      eventType: 'company.member.joined',
      message: `${user.email} accepted invite to ${invite.company.name}`,
      level: 'info',
      metadata: { userId: user.id, inviteId: invite.id },
    });

    return {
      message: 'Invite accepted',
      companyId: invite.companyId,
      companyName: invite.company.name,
      userId: user.id,
      email: user.email,
    };
  }

  async resetApiConfig(companyId: string, userId: string) {
    await this.requireMember(companyId, userId);

    const testKeys = await this.companySettingsService.regenerateApiKeys(
      companyId,
      userId,
      SettingsType.TEST,
    );
    let liveKeys: { publicKey: string; secretKey: string } | null = null;
    try {
      liveKeys = await this.companySettingsService.regenerateApiKeys(
        companyId,
        userId,
        SettingsType.LIVE,
      );
    } catch {
      liveKeys = null;
    }

    const webhooksDisabled =
      await this.companySettingsService.deactivateAllWebhooks(companyId, userId);

    await this.loggingService.safeCreateLog({
      companyId,
      environment: 'test',
      eventType: 'company.api_config.reset',
      message: 'API configuration reset (keys regenerated, webhooks disabled)',
      level: 'warning',
      metadata: { userId, webhooksDisabled },
    });

    return {
      message:
        'API config reset. Save the new keys now; previous keys no longer work. Webhooks were disabled.',
      webhooksDisabled,
      keys: {
        test: testKeys,
        live: liveKeys,
      },
    };
  }

  async deleteCompany(
    companyId: string,
    userId: string,
    dto: DeleteCompanyDto,
  ) {
    const company = await this.requireMember(companyId, userId);
    if (dto.confirmation.trim() !== company.name) {
      throw new BadRequestException(
        'Confirmation must match the company name exactly',
      );
    }

    await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ currentCompanyId: null })
      .where('"currentCompanyId" = :companyId', { companyId })
      .execute();

    const memberIds = (company.members || []).map((m) => m.id);
    if (memberIds.length) {
      await this.companyRepository
        .createQueryBuilder()
        .relation(Company, 'members')
        .of(companyId)
        .remove(memberIds);
    }

    const queryRunner =
      this.companyRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        `DELETE FROM "webhook_events" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "webhooks" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "settings" WHERE "companySettingsId" IN (SELECT id FROM "company_settings" WHERE "companyId" = $1)`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "company_settings" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "company_invites" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "invoices" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "zoho_invoice_jobs" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "zoho_webhook_endpoints" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "zoho_connections" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "quickbooks_invoice_jobs" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "quickbooks_connections" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "xero_invoice_jobs" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(
        `DELETE FROM "xero_connections" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.query(`DELETE FROM "logs" WHERE "companyId" = $1`, [
        companyId,
      ]);
      await queryRunner.query(
        `DELETE FROM "user_companies" WHERE "companyId" = $1`,
        [companyId],
      );
      await queryRunner.manager.delete(Company, { id: companyId });
      await queryRunner.commitTransaction();
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to delete company ${companyId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to delete company');
    } finally {
      await queryRunner.release();
    }

    return { message: `Company "${company.name}" deleted` };
  }

  private async requireMember(companyId: string, userId: string) {
    const company = await this.companyRepository.findOne({
      where: { id: companyId },
      relations: ['members'],
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    const isMember = company.members?.some((m) => m.id === userId);
    if (!isMember) {
      throw new ForbiddenException('You do not have access to this company');
    }
    return company;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
