import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { SignupDto } from '../auth/dto/signup.dto';
import { EmailService } from '../common/services/email.service';
import { OtpGeneratorUtil } from '../common/utils/otp-generator.util';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private emailService: EmailService,
    private loggingService: LoggingService,
  ) {}

  async create(signupDto: SignupDto): Promise<User> {
    // Check if user exists
    const existingUser = await this.userRepository.findOne({
      where: { email: signupDto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(signupDto.password, saltRounds);

    // Create user
    const user = this.userRepository.create({
      email: signupDto.email.toLowerCase(),
      passwordHash,
      mfaEnabled: false,
      isEmailVerified: false,
    });

    const savedUser = await this.userRepository.save(user);

    // Generate and send OTP for email verification
    const otpCode = OtpGeneratorUtil.generateOTP();
    const otpExpiresAt = OtpGeneratorUtil.generateOTPExpiration(10);

    await this.userRepository.update(savedUser.id, {
      otpCode,
      otpExpiresAt,
    });

    // Send OTP via email
    await this.emailService.sendOTP(savedUser.email, otpCode);

    // Log user signup (no company yet, so we'll log without companyId)
    try {
      await this.loggingService.createLog({
        companyId: 'system', // Use 'system' for events without company context
        environment: 'test',
        eventType: 'user.signup',
        message: 'New user registered',
        level: 'info',
        metadata: { userId: savedUser.id, email: savedUser.email },
      });
    } catch (error) {
      // Don't fail signup if logging fails
    }

    return savedUser;
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['companies'],
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      relations: ['companies'],
    });
  }

  async update(userId: string, updates: Partial<User>): Promise<User> {
    await this.userRepository.update(userId, updates);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async addCompanyToUser(userId: string, companyId: string): Promise<void> {
    // This is now handled in the companies service when creating a company
    // The relationship is managed through TypeORM's many-to-many relationship
  }
}
