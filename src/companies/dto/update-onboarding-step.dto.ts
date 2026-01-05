import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOnboardingStepDto {
  @ApiProperty({
    description: 'Whether the onboarding step is completed',
    example: true,
  })
  @IsBoolean()
  completed: boolean;
}

