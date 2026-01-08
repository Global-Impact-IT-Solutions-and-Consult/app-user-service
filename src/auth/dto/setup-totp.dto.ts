import { ApiProperty } from '@nestjs/swagger';

export class SetupTotpResponseDto {
  @ApiProperty({
    description: 'QR code data URL for scanning with authenticator app',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  qrCode: string;

  @ApiProperty({
    description: 'Temporary secret for verification (only shown once)',
    example: 'JBSWY3DPEHPK3PXP',
  })
  secret: string;

  @ApiProperty({
    description: 'Manual entry key for authenticator apps that support it',
    example: 'JBSWY3DPEHPK3PXP',
  })
  manualEntryKey: string;
}

