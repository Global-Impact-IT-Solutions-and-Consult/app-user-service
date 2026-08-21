import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { InvoiceSource, NrsInvoiceStatus } from '../entities/invoice.entity';

export class QueryInvoicesDto {
  @ApiPropertyOptional({ enum: InvoiceSource })
  @IsOptional()
  @IsEnum(InvoiceSource)
  source?: InvoiceSource;

  @ApiPropertyOptional({ enum: NrsInvoiceStatus })
  @IsOptional()
  @IsEnum(NrsInvoiceStatus)
  nrsStatus?: NrsInvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 25;
}
