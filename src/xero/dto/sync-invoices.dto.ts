import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SyncXeroInvoicesDto {
  @ApiPropertyOptional({
    description:
      'ISO timestamp override for If-Modified-Since (defaults to lastSyncedAt or 24h ago)',
  })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({
    description:
      'If false, only create jobs without submitting to receipt service',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  submitForProcessing?: boolean;
}

export class SetXeroTenantDto {
  @ApiProperty({ description: 'Xero tenant / organisation ID' })
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantName?: string;
}
