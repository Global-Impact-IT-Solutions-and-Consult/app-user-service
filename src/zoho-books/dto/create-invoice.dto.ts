import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceLineItemDto {
  @ApiProperty({ description: 'Line item name/description', example: 'API usage' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Quantity', example: 1 })
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @ApiProperty({ description: 'Unit rate', example: 99.0 })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ description: 'Optional Zoho item ID' })
  @IsOptional()
  @IsString()
  itemId?: string;
}

export class CreateInvoiceDto {
  @ApiPropertyOptional({
    description: 'Zoho customer/contact ID (defaults to synced company contact)',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Invoice date (YYYY-MM-DD)',
    example: '2026-07-16',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Due date (YYYY-MM-DD)',
    example: '2026-07-30',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({
    description: 'Invoice line items',
    type: [InvoiceLineItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems: InvoiceLineItemDto[];

  @ApiPropertyOptional({ description: 'Notes on the invoice' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'If true, mark the invoice as sent in Zoho',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  send?: boolean;
}

export class SyncContactDto {
  @ApiPropertyOptional({
    description: 'Override contact email used in Zoho',
    example: 'billing@acme.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'Override contact phone',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
