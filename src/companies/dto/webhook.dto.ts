import { IsUrl, IsEnum, IsArray, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettingsType } from '../entities/settings.entity';

export class CreateWebhookDto {
  @ApiProperty({
    description: 'Webhook URL to receive events',
    example: 'https://example.com/webhooks',
  })
  @IsUrl()
  url: string;

  @ApiProperty({
    description: 'Settings type (test or live)',
    enum: SettingsType,
    example: SettingsType.TEST,
  })
  @IsEnum(SettingsType)
  environment: SettingsType;

  @ApiPropertyOptional({
    description: 'Event types to subscribe to',
    example: ['receipt.created', 'receipt.updated'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({
    description: 'Webhook URL to receive events',
    example: 'https://example.com/webhooks',
  })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional({
    description: 'Event types to subscribe to',
    example: ['receipt.created', 'receipt.updated'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({
    description: 'Webhook active status',
    example: true,
  })
  @IsOptional()
  isActive?: boolean;
}

export class TestWebhookDto {
  @ApiProperty({
    description: 'Event type to test',
    example: 'receipt.created',
  })
  @IsString()
  eventType: string;

  @ApiPropertyOptional({
    description: 'Custom payload for test event',
    example: { receiptId: '123', amount: 100 },
  })
  @IsOptional()
  payload?: Record<string, any>;
}
