import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  TestWebhookDto,
} from './dto/webhook.dto';
import { UpdateOnboardingStepDto } from './dto/update-onboarding-step.dto';
import { RegenerateApiKeysDto } from './dto/regenerate-api-keys.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('companies')
@ApiBearerAuth('JWT-auth')
@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new company' })
  @ApiBody({ type: CreateCompanyDto })
  @ApiResponse({ status: 201, description: 'Company created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createCompany(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createCompanyDto: CreateCompanyDto,
  ) {
    return this.companiesService.create(user.userId, createCompanyDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all companies for the current user' })
  @ApiResponse({ status: 200, description: 'List of companies' })
  async getUserCompanies(@CurrentUser() user: CurrentUserPayload) {
    return this.companiesService.findUserCompanies(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company details by ID' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Company details' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getCompany(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.companiesService.findById(id);
    if (!company) {
      throw new NotFoundException(`Company with ID ${id} not found`);
    }

    // Check if user is a member of the company
    const isMember = company.members?.some(
      (member) => member.id === user.userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You do not have access to this company',
      );
    }

    return company;
  }

  @Put(':id/onboarding/:step')
  @ApiOperation({ summary: 'Update onboarding step status' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'step', description: 'Onboarding step name' })
  @ApiBody({ type: UpdateOnboardingStepDto })
  @ApiResponse({ status: 200, description: 'Onboarding step updated' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateOnboardingStep(
    @Param('id') companyId: string,
    @Param('step') step: string,
    @Body() body: UpdateOnboardingStepDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.companiesService.findById(companyId);
    if (!company) {
      throw new NotFoundException(`Company with ID ${companyId} not found`);
    }

    const isMember = company.members?.some(
      (member) => member.id === user.userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You do not have access to this company',
      );
    }

    return this.companiesService.updateOnboardingStep(
      companyId,
      step,
      body.completed,
    );
  }

  // API Key Management
  @Get(':id/api-keys')
  @ApiOperation({ summary: 'Get all API keys for a company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'List of API keys' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getApiKeys(
    @Param('id') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.companiesService.getApiKeys(companyId, user.userId);
  }

  @Delete(':id/api-keys/:keyId')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'keyId', description: 'API Key ID' })
  @ApiResponse({ status: 200, description: 'API key revoked successfully' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async revokeApiKey(
    @Param('id') companyId: string,
    @Param('keyId') keyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.companiesService.revokeApiKey(keyId, companyId, user.userId);
    return { message: 'API key revoked successfully' };
  }

  @Post(':id/api-keys/regenerate')
  @ApiOperation({ summary: 'Regenerate API keys for a specific environment' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiBody({ type: RegenerateApiKeysDto })
  @ApiResponse({
    status: 200,
    description: 'API keys regenerated successfully',
    schema: {
      example: {
        publicKey: 'pk_test_abc123...',
        secretKey: 'sk_test_xyz789...',
        environment: 'test',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Company or settings not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async regenerateApiKeys(
    @Param('id') companyId: string,
    @Body() regenerateDto: RegenerateApiKeysDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.companiesService.regenerateApiKeys(
      companyId,
      user.userId,
      regenerateDto.environment,
    );
  }

  // Webhook Management
  @Post(':id/webhooks')
  @ApiOperation({ summary: 'Create a new webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiBody({ type: CreateWebhookDto })
  @ApiResponse({ status: 201, description: 'Webhook created successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async createWebhook(
    @Param('id') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() createWebhookDto: CreateWebhookDto,
  ) {
    return this.companiesService.createWebhook(
      companyId,
      user.userId,
      createWebhookDto,
    );
  }

  @Get(':id/webhooks')
  @ApiOperation({ summary: 'Get all webhooks for a company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiQuery({
    name: 'environment',
    required: false,
    description: 'Filter by environment (test/live)',
  })
  @ApiResponse({ status: 200, description: 'List of webhooks' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getWebhooks(
    @Param('id') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('environment') environment?: string,
  ) {
    return this.companiesService.getWebhooks(
      companyId,
      user.userId,
      environment,
    );
  }

  @Put(':id/webhooks/:webhookId')
  @ApiOperation({ summary: 'Update a webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiBody({ type: UpdateWebhookDto })
  @ApiResponse({ status: 200, description: 'Webhook updated successfully' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() updateWebhookDto: UpdateWebhookDto,
  ) {
    return this.companiesService.updateWebhook(
      webhookId,
      companyId,
      user.userId,
      updateWebhookDto,
    );
  }

  @Delete(':id/webhooks/:webhookId')
  @ApiOperation({ summary: 'Delete a webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook deleted successfully' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async deleteWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.companiesService.deleteWebhook(
      webhookId,
      companyId,
      user.userId,
    );
    return { message: 'Webhook deleted successfully' };
  }

  @Post(':id/webhooks/:webhookId/test')
  @ApiOperation({ summary: 'Test a webhook by sending a test event' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiBody({ type: TestWebhookDto })
  @ApiResponse({ status: 200, description: 'Webhook test result' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 400, description: 'Webhook is not active' })
  async testWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() testDto: TestWebhookDto,
  ) {
    return this.companiesService.testWebhook(
      webhookId,
      companyId,
      user.userId,
      testDto,
    );
  }

  @Post(':id/webhooks/:webhookId/regenerate-secret')
  @ApiOperation({ summary: 'Regenerate webhook signing secret' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook secret regenerated' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async regenerateWebhookSecret(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const secret = await this.companiesService.regenerateWebhookSecret(
      webhookId,
      companyId,
      user.userId,
    );
    return {
      message: 'Webhook secret regenerated. Please save it securely.',
      signingSecret: secret,
    };
  }
}
