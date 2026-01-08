import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisableTotpDto {
  @ApiProperty({
    description: '6-digit TOTP code from authenticator app to confirm disable',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6)
  code: string;
}

