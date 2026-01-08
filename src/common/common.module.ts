import { Module, Global } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { TotpService } from './services/totp.service';

@Global()
@Module({
  providers: [EmailService, TotpService],
  exports: [EmailService, TotpService],
})
export class CommonModule {}
