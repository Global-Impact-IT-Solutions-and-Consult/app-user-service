import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { CompanySettingsModule } from './company-settings/company-settings.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { LoggingModule } from './logging/logging.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // PostgreSQL Connection with TypeORM
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST') || 'localhost',
        port: parseInt(config.get<string>('DB_PORT') || '5432'),
        username: config.get<string>('DB_USERNAME') || 'postgres',
        password: config.get<string>('DB_PASSWORD') || 'postgres',
        database: config.get<string>('DB_DATABASE') || 'user-service',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get<string>('NODE_ENV') !== 'production', // Auto-sync schema in dev (disabled in production)
        logging: config.get<string>('NODE_ENV') === 'development',
        migrationsRun: false, // Don't run migrations automatically
        migrations: [__dirname + '/**/migrations/*{.ts,.js}'],
      }),
    }),
    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),
    // Common Module (Email Service)
    CommonModule,
    // Feature Modules
    AuthModule,
    UsersModule,
    CompaniesModule,
    CompanySettingsModule,
    ReceiptsModule,
    LoggingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
