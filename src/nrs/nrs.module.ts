import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NrsMapper } from './nrs.mapper';
import { StubNrsClient } from './stub-nrs.client';
import { HttpNrsClient } from './http-nrs.client';
import { NRS_CLIENT } from './nrs.types';

@Module({
  providers: [
    NrsMapper,
    StubNrsClient,
    HttpNrsClient,
    {
      provide: NRS_CLIENT,
      inject: [ConfigService, StubNrsClient, HttpNrsClient],
      useFactory: (
        config: ConfigService,
        stub: StubNrsClient,
        http: HttpNrsClient,
      ) => (config.get<string>('NRS_ENABLED') === 'true' ? http : stub),
    },
  ],
  exports: [NrsMapper, NRS_CLIENT],
})
export class NrsModule {}
