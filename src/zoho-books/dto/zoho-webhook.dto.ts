import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateZohoWebhookDto {
  @ApiPropertyOptional({
    description: 'Environment used when submitting invoices to the receipt service',
    example: 'test',
  })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({
    description:
      'If true, issue a new webhook URL and signing secret (business must update Zoho)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rotate?: boolean;
}
