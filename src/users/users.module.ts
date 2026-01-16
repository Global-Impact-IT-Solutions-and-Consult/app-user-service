import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CommonModule } from '../common/common.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), CommonModule, LoggingModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
