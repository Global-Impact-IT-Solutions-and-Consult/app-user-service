import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Environment } from '../../users/schemas/user.schema';

export class SwitchEnvironmentDto {
  @ApiProperty({
    description: 'Target environment to switch to',
    enum: Environment,
    example: Environment.TEST,
  })
  @IsEnum(Environment)
  environment: Environment;

  @ApiPropertyOptional({
    description: 'Company ID to switch to (optional)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  companyId?: string;
}

