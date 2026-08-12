import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateXeroPollingDto {
  @ApiProperty({
    description: 'Whether the scheduled Xero invoice poller should run for this connection',
  })
  @IsBoolean()
  pollingEnabled: boolean;
}
