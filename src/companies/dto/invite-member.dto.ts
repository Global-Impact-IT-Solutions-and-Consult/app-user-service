import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class InviteMemberDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    enum: ['member', 'admin'],
    default: 'member',
  })
  @IsOptional()
  @IsString()
  @IsIn(['member', 'admin'])
  role?: 'member' | 'admin';
}
