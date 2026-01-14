import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableTotpTempDto {
  @ApiProperty({
    description: 'Temporary token from signup/login response',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  tempToken: string;

  @ApiProperty({
    description: '6-digit TOTP code from authenticator app',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({
    description: 'Temporary secret from setup endpoint',
    example: 'JBSWY3DPEHPK3PXP',
  })
  @IsString()
  secret: string;
}

