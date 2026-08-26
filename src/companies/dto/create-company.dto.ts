import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
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
    description: 'Business type / legal structure',
    example: 'Limited Liability Company',
  })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({
    description: 'Primary business industry',
    example: 'Technology',
  })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({
    description: 'Registered business address',
    example: '123 Industrial Estate, Lagos, Nigeria',
  })
  @IsOptional()
  @IsString()
  registeredAddress?: string;

  @ApiPropertyOptional({
    description: 'Primary company contact phone',
    example: '+2348012345678',
  })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({
    description: 'Primary company contact person',
    example: 'Ada Okafor',
  })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({
    description: 'Primary company contact email',
    example: 'finance@example.com',
  })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({
    description: 'Company documents (document type -> URL/storage path)',
    example: { 'certificate': 'https://storage.example.com/cert.pdf' },
  })
  @IsOptional()
  @IsObject()
  documents?: Record<string, string>;
}
