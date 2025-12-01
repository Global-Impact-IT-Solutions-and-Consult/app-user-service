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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  TestWebhookDto,
} from './dto/webhook.dto';
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
  async getCompany(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const company = await this.companiesService.findById(id);
    if (!company || !company.members.some((m: any) => m.toString() === user.userId)) {
      throw new Error('Company not found or access denied');
    }
    return company;
  }

  @Put(':id/onboarding/:step')
  @ApiOperation({ summary: 'Update onboarding step status' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'step', description: 'Onboarding step name' })
  @ApiResponse({ status: 200, description: 'Onboarding step updated' })
  async updateOnboardingStep(
    @Param('id') companyId: string,
    @Param('step') step: string,
    @Body() body: { completed: boolean },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.companiesService.findById(companyId);
    if (!company || !company.members.some((m: any) => m.toString() === user.userId)) {
      throw new Error('Access denied');
    }
    return this.companiesService.updateOnboardingStep(companyId, step, body.completed);
  }

  // API Key Management
  @Get(':id/api-keys')
  @ApiOperation({ summary: 'Get all API keys for a company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'List of API keys' })
  async getApiKeys(@Param('id') companyId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.companiesService.getApiKeys(companyId, user.userId);
  }

  @Delete(':id/api-keys/:keyId')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'keyId', description: 'API Key ID' })
  @ApiResponse({ status: 200, description: 'API key revoked successfully' })
  async revokeApiKey(
    @Param('id') companyId: string,
    @Param('keyId') keyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.companiesService.revokeApiKey(keyId, companyId, user.userId);
    return { message: 'API key revoked successfully' };
  }

  // Webhook Management
  @Post(':id/webhooks')
  @ApiOperation({ summary: 'Create a new webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiResponse({ status: 201, description: 'Webhook created successfully' })
  async createWebhook(
    @Param('id') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() createWebhookDto: CreateWebhookDto,
  ) {
    return this.companiesService.createWebhook(companyId, user.userId, createWebhookDto);
  }

  @Get(':id/webhooks')
  @ApiOperation({ summary: 'Get all webhooks for a company' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiQuery({ name: 'environment', required: false, description: 'Filter by environment (test/live)' })
  @ApiResponse({ status: 200, description: 'List of webhooks' })
  async getWebhooks(
    @Param('id') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('environment') environment?: string,
  ) {
    return this.companiesService.getWebhooks(companyId, user.userId, environment);
  }

  @Put(':id/webhooks/:webhookId')
  @ApiOperation({ summary: 'Update a webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook updated successfully' })
  async updateWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() updateWebhookDto: UpdateWebhookDto,
  ) {
    return this.companiesService.updateWebhook(webhookId, companyId, user.userId, updateWebhookDto);
  }

  @Delete(':id/webhooks/:webhookId')
  @ApiOperation({ summary: 'Delete a webhook' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook deleted successfully' })
  async deleteWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.companiesService.deleteWebhook(webhookId, companyId, user.userId);
    return { message: 'Webhook deleted successfully' };
  }

  @Post(':id/webhooks/:webhookId/test')
  @ApiOperation({ summary: 'Test a webhook by sending a test event' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook test result' })
  async testWebhook(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() testDto: TestWebhookDto,
  ) {
    return this.companiesService.testWebhook(webhookId, companyId, user.userId, testDto);
  }

  @Post(':id/webhooks/:webhookId/regenerate-secret')
  @ApiOperation({ summary: 'Regenerate webhook signing secret' })
  @ApiParam({ name: 'id', description: 'Company ID' })
  @ApiParam({ name: 'webhookId', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook secret regenerated' })
  async regenerateWebhookSecret(
    @Param('id') companyId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const secret = await this.companiesService.regenerateWebhookSecret(webhookId, companyId, user.userId);
    return {
      message: 'Webhook secret regenerated. Please save it securely.',
      signingSecret: secret,
    };
  }
}
