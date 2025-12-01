import { IsString, Length, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MfaVerifyDto {
  @ApiProperty({
    description: 'User ID from login response',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    description: '6-digit OTP code sent to your email',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiPropertyOptional({
    description: 'Temporary token from login response (optional)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString()
  tempToken?: string;
}
