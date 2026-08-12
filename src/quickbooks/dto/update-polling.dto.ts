import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateQuickBooksPollingDto {
  @ApiProperty({
    description: 'Whether the scheduled QuickBooks invoice poller should run for this connection',
  })
  @IsBoolean()
  pollingEnabled: boolean;
}
