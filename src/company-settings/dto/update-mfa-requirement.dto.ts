import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMfaRequirementDto {
  @ApiProperty({
    description: 'Whether MFA is required for all users in the company',
    example: true,
  })
  @IsBoolean()
  mfaRequired: boolean;
}

