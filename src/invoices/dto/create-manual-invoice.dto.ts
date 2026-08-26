import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateManualInvoiceLineDto {
  @ApiProperty({ example: 'Implementation services' })
  @IsString()
  description: string;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ example: 150000, minimum: 0 })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ example: 7.5, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class CreateManualInvoiceDto {
  @ApiProperty({ example: 'Acme Customer Ltd' })
  @IsString()
  customerName: string;

  @ApiPropertyOptional({ example: '12345678-0001' })
  @IsOptional()
  @IsString()
  customerTaxId?: string;

  @ApiPropertyOptional({ example: 'finance@customer.com' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ example: 'INV-2026-001' })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiProperty({ example: '2026-08-26' })
  @IsDateString()
  invoiceDate: string;

  @ApiProperty({ example: '2026-09-25' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ example: 'NGN', default: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: [CreateManualInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateManualInvoiceLineDto)
  lineItems: CreateManualInvoiceLineDto[];

  @ApiPropertyOptional({ example: 'Payment due within 30 days.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'When true, immediately submit the invoice to NRS after creating it.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  sendInvoice?: boolean;
}
