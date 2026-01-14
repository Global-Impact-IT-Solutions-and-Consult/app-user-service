import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetupTotpTempDto {
  @ApiProperty({
    description: 'Temporary token from signup/login response',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  tempToken: string;
}

