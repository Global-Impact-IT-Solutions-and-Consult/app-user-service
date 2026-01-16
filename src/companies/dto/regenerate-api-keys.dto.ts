import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SettingsType } from '../entities/settings.entity';

export class RegenerateApiKeysDto {
  @ApiProperty({
    description: 'Environment type for which to regenerate API keys',
    enum: SettingsType,
    example: SettingsType.TEST,
  })
  @IsEnum(SettingsType)
  environment: SettingsType;
}




