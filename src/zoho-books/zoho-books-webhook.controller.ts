import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Headers,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ZohoBooksService } from './zoho-books.service';
import { CreateZohoWebhookDto } from './dto/zoho-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

/**
 * Optional Zoho webhook push path (separate from OAuth + poll).
 * Frontend integrating OAuth-only can ignore this tag.
 */
@ApiTags('zoho-books-webhooks')
@Controller('zoho-books')
export class ZohoBooksWebhookController {
  constructor(private zohoBooksService: ZohoBooksService) {}

  @Post('hooks/:webhookToken')
  @ApiOperation({
    summary:
      'Public Zoho Books webhook receiver (unique URL per business). Zoho posts invoices here.',
  })
  @ApiParam({ name: 'webhookToken' })
  @ApiResponse({ status: 200, description: 'Webhook accepted' })
  async inboundWebhook(
    @Param('webhookToken') webhookToken: string,
    @Body() body: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ) {
    const rawBody =
      (req as any).rawBody ||
      (typeof body === 'string' ? body : JSON.stringify(body || {}));
    const isTest =
      body?.event_type === 'connection.test' ||
      body?.eventType === 'connection.test' ||
      body?.source === 'ibookam_simulate';

    return this.zohoBooksService.handleInboundWebhook(
      webhookToken,
      body,
      headers,
      rawBody,
      { isTest },
    );
  }

  @Post(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Create or get this business’s unique Zoho webhook URL (set rotate=true to issue a new URL/secret)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiBody({ type: CreateZohoWebhookDto, required: false })
  async createWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateZohoWebhookDto,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    const payload = dto || {};
    if (payload.rotate) {
      return this.zohoBooksService.rotateWebhookEndpoint(companyId, payload);
    }
    return this.zohoBooksService.createOrGetWebhookEndpoint(companyId, payload);
  }

  @Get(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Webhook status: pending (waiting for Zoho) vs connected, plus last event time',
  })
  @ApiParam({ name: 'companyId' })
  async getWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.getWebhookEndpointStatus(companyId);
  }

  @Post(':companyId/webhook/simulate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Simulate a Zoho webhook hit to confirm the link works (marks connected)',
  })
  @ApiParam({ name: 'companyId' })
  async simulateWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.simulateWebhook(companyId);
  }

  @Delete(':companyId/webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable this business Zoho webhook' })
  @ApiParam({ name: 'companyId' })
  async disableWebhook(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.zohoBooksService.assertCompanyMember(companyId, user.userId);
    return this.zohoBooksService.disableWebhookEndpoint(companyId);
  }
}
