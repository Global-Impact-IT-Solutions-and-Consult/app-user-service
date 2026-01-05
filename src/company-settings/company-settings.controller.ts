import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { CompanySettingsService } from './company-settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UpdateMfaRequirementDto } from './dto/update-mfa-requirement.dto';

@ApiTags('company-settings')
@ApiBearerAuth('JWT-auth')
@Controller('company-settings')
@UseGuards(JwtAuthGuard)
export class CompanySettingsController {
  constructor(
    private companySettingsService: CompanySettingsService,
  ) {}

  @Get('company/:companyId')
  @ApiOperation({ summary: 'Get company settings' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Company settings retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Company settings not found' })
  async getCompanySettings(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.companySettingsService.getCompanySettings(
      companyId,
      user.userId,
    );
  }

  @Put('company/:companyId/mfa')
  @ApiOperation({ summary: 'Update MFA requirement for company' })
  @ApiParam({ name: 'companyId', description: 'Company ID' })
  @ApiBody({ type: UpdateMfaRequirementDto })
  @ApiResponse({ status: 200, description: 'MFA requirement updated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateMfaRequirement(
    @Param('companyId') companyId: string,
    @Body() dto: UpdateMfaRequirementDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.companySettingsService.updateMfaRequirement(
      companyId,
      user.userId,
      dto.mfaRequired,
    );
  }
}

