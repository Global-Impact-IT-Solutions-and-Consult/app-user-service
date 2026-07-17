import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ImportInvoiceDto {
  @ApiPropertyOptional({
    description:
      'Environment forwarded to the receipt service (defaults to JWT environment)',
    example: 'test',
  })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({
    description:
      'If true (default), automatically submit the invoice PDF/JSON to the receipt service',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  submitForProcessing?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, after import+submit immediately attempt write-back when processing looks complete',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  writeBackIfReady?: boolean;
}

export class WriteBackInvoiceDto {
  @ApiPropertyOptional({
    description: 'Override notes written back to Zoho',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'If true (default), attach the processed receipt/PDF back onto the Zoho invoice when available',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  attachProcessedFile?: boolean;

  @ApiPropertyOptional({
    description:
      'If true (default), add a Zoho invoice comment summarizing the processing result',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  addComment?: boolean;
}
