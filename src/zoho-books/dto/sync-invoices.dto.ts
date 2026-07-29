import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SyncZohoInvoicesDto {
  @ApiPropertyOptional({
    description:
      'ISO timestamp override for last_modified_time filter (defaults to lastSyncedAt or 24h ago)',
  })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({
    description: 'If false, only create jobs without submitting to receipt service',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  submitForProcessing?: boolean;
}
