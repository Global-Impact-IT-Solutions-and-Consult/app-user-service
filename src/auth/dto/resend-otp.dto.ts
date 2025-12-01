import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendOtpDto {
  @ApiProperty({
    description: 'User ID from signup/login response',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  userId: string;
}
