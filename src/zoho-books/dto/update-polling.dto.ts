import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateZohoPollingDto {
  @ApiProperty({
    description: 'Whether the scheduled Zoho Books invoice poller should run for this connection',
  })
  @IsBoolean()
  pollingEnabled: boolean;
}
