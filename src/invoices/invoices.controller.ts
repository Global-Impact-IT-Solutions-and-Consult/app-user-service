import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { CreateManualInvoiceDto } from './dto/create-manual-invoice.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('invoices')
@Controller('invoices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Post(':companyId')
  @ApiOperation({ summary: 'Create a GIITSC manual invoice for a company' })
  @ApiParam({ name: 'companyId' })
  async createManual(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateManualInvoiceDto,
  ) {
    return this.invoicesService.createManual(companyId, user.userId, dto);
  }

  @Get(':companyId')
  @ApiOperation({ summary: 'List stored invoices for a company' })
  @ApiParam({ name: 'companyId' })
  async list(
    @Param('companyId') companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: QueryInvoicesDto,
  ) {
    await this.invoicesService.assertCompanyMember(companyId, user.userId);
    return this.invoicesService.list(companyId, query);
  }

  @Get(':companyId/:invoiceId/nrs')
  @ApiOperation({
    summary: 'Get stored NRS clearance artefacts (IRN, CSID, QR)',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async getNrs(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.invoicesService.assertCompanyMember(companyId, user.userId);
    return this.invoicesService.getNrsArtefacts(companyId, invoiceId);
  }

  @Post(':companyId/:invoiceId/nrs/preview')
  @ApiOperation({
    summary: 'Map a stored invoice to NRS JSON without calling NRS',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async previewNrs(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.invoicesService.assertCompanyMember(companyId, user.userId);
    return this.invoicesService.previewNrs(companyId, invoiceId);
  }

  @Post(':companyId/:invoiceId/nrs/submit')
  @ApiOperation({
    summary:
      'Submit invoice to NRS (stub unless NRS_ENABLED=true) and store IRN/QR',
  })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async submitNrs(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.invoicesService.assertCompanyMember(companyId, user.userId);
    return this.invoicesService.submitNrs(companyId, invoiceId);
  }

  @Get(':companyId/:invoiceId')
  @ApiOperation({ summary: 'Get one stored invoice' })
  @ApiParam({ name: 'companyId' })
  @ApiParam({ name: 'invoiceId' })
  async get(
    @Param('companyId') companyId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.invoicesService.assertCompanyMember(companyId, user.userId);
    return this.invoicesService.get(companyId, invoiceId);
  }
}
