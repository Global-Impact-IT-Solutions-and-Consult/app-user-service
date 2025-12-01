import { IsString, MinLength, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty({
    description: 'Company name',
    example: 'Acme Corporation',
    minLength: 2,
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    description: 'Legal company name',
    example: 'Acme Corporation Inc.',
  })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({
    description: 'Company tax ID',
    example: 'TAX123456789',
  })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({
    description: 'Company documents (document type -> URL/storage path)',
    example: { 'certificate': 'https://storage.example.com/cert.pdf' },
  })
  @IsOptional()
  @IsObject()
  documents?: Record<string, string>;
}

