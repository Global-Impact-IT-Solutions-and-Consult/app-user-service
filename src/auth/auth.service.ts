import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, Environment } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { SwitchEnvironmentDto } from './dto/switch-environment.dto';
import { UsersService } from '../users/users.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { EmailService } from '../common/services/email.service';
import { TotpService } from '../common/services/totp.service';
import { OtpGeneratorUtil } from '../common/utils/otp-generator.util';
import { CompanySettingsService } from '../company-settings/company-settings.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Company)
    private companyRepository: Repository<Company>,
    private jwtService: JwtService,
    private usersService: UsersService,
    private emailService: EmailService,
    private totpService: TotpService,
    private companySettingsService: CompanySettingsService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    // Validate password and hash exist
    if (!password || !user.passwordHash) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await this.handleFailedLogin(user);
      return null;
    }

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    // Validate password and hash exist
    if (!loginDto.password) {
      throw new UnauthorizedException('Password is required');
    }

    if (!user.passwordHash && !user.isGoogleAuth) {
      throw new UnauthorizedException(
        'Account configuration error. Please contact support.',
      );
    }

    // For Google auth users, skip password check
    if (!user.isGoogleAuth) {
      // Verify password
      if (!user.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const isPasswordValid = await bcrypt.compare(
        loginDto.password,
        user.passwordHash,
      );

      if (!isPasswordValid) {
        await this.handleFailedLogin(user);
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // Reset failed attempts on successful password check
    await this.userRepository.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    // Check if company requires MFA
    let companyRequiresMfa = false;
    if (user.currentCompanyId) {
      try {
        const companySettings =
          await this.companySettingsService.getCompanySettings(
            user.currentCompanyId,
            user.id,
          );
        companyRequiresMfa = companySettings.mfaRequired;
      } catch (error) {
        // If company settings not found or access denied, default to requiring MFA
        companyRequiresMfa = true;
      }
    } else {
      // Default to requiring MFA if no company
      companyRequiresMfa = true;
    }

    // Generate and send OTP via email (as fallback or if TOTP not enabled)
    const otpCode = OtpGeneratorUtil.generateOTP();
    const otpExpiresAt = OtpGeneratorUtil.generateOTPExpiration(10); // 10 minutes

    await this.userRepository.update(user.id, {
      otpCode,
      otpExpiresAt,
      mfaEnabled: true,
    });

    // Send OTP via email (always send as fallback)
    await this.emailService.sendOTP(user.email, otpCode);

    const response: any = {
      requiresMfa: true,
      message: user.totpEnabled
        ? 'Use your authenticator app or check your email for OTP'
        : 'OTP sent to your email',
      tempToken: await this.generateTempToken(user.id),
    };

    if (user.totpEnabled) {
      response.totpEnabled = true;
      response.mfaMethods = ['totp', 'email'];
    } else {
      response.mfaMethods = ['email'];
    }

    return response;
  }

  async verifyMfa(mfaVerifyDto: MfaVerifyDto) {
    const user = await this.userRepository.findOne({
      where: { id: mfaVerifyDto.userId },
      relations: ['companies'],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid MFA session');
    }

    let isVerified = false;

    // Check if user has authenticator app enabled - try TOTP first
    if (user.totpEnabled && user.totpSecret) {
      // Verify TOTP code from authenticator app
      const isValidTotp = this.totpService.verifyToken(
        mfaVerifyDto.code,
        user.totpSecret,
      );

      if (isValidTotp) {
        isVerified = true;
      }
    }

    // If TOTP verification didn't succeed, try email OTP
    if (!isVerified) {
      // Check if OTP exists and is not expired
      if (!user.otpCode || !user.otpExpiresAt) {
        throw new UnauthorizedException(
          'No OTP found. Please request a new one.',
        );
      }

      if (OtpGeneratorUtil.isOTPExpired(user.otpExpiresAt)) {
        throw new UnauthorizedException(
          'OTP has expired. Please request a new one.',
        );
      }

      // Verify OTP code
      if (user.otpCode !== mfaVerifyDto.code) {
        throw new UnauthorizedException('Invalid OTP code');
      }

      isVerified = true;
    }

    if (!isVerified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Clear OTP after successful verification
    await this.userRepository.update(user.id, {
      otpCode: null,
      otpExpiresAt: null,
    });

    // Set default environment to TEST if not set
    let currentEnvironment = user.currentEnvironment || Environment.TEST;

    // Set default company if user has companies
    let currentCompanyId: string | undefined =
      user.currentCompanyId || undefined;
    if (!currentCompanyId && user.companies && user.companies.length > 0) {
      currentCompanyId = user.companies[0].id;
    }

    // Update user
    await this.userRepository.update(user.id, {
      currentEnvironment,
      currentCompanyId,
      lastLoginAt: new Date(),
      isEmailVerified: true, // Email is verified when OTP is used
    });

    // Generate JWT with environment scope
    const payload = await this.buildJwtPayload(
      user.id,
      currentCompanyId,
      currentEnvironment,
      user.email,
      user.roles || [],
      user.permissions || [],
    );
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        currentEnvironment,
        currentCompanyId,
      },
    };
  }

  async resendOTP(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate new OTP
    const otpCode = OtpGeneratorUtil.generateOTP();
    const otpExpiresAt = OtpGeneratorUtil.generateOTPExpiration(10);

    await this.userRepository.update(userId, {
      otpCode,
      otpExpiresAt,
    });

    // Send OTP via email
    await this.emailService.sendOTP(user.email, otpCode);

    return {
      message: 'OTP sent to your email',
      tempToken: await this.generateTempToken(userId),
    };
  }

  async googleLogin(googleUser: any) {
    const { googleId, email, firstName, lastName, picture } = googleUser;

    // Find or create user
    let user = await this.userRepository.findOne({
      where: [{ email: email.toLowerCase() }, { googleId }],
    });

    if (!user) {
      // Create new user with Google auth
      user = this.userRepository.create({
        email: email.toLowerCase(),
        googleId,
        isGoogleAuth: true,
        mfaEnabled: false,
        isEmailVerified: true, // Google emails are pre-verified
        passwordHash: undefined, // No password for Google auth users
      });
      await this.userRepository.save(user);

      // Send welcome email
      await this.emailService.sendWelcomeEmail(email, firstName);
    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = googleId;
      user.isGoogleAuth = true;
      await this.userRepository.save(user);
    }

    // Check if company requires MFA
    let companyRequiresMfa = false;
    if (user.currentCompanyId) {
      try {
        const companySettings =
          await this.companySettingsService.getCompanySettings(
            user.currentCompanyId,
            user.id,
          );
        companyRequiresMfa = companySettings.mfaRequired;
      } catch (error) {
        // If company settings not found or access denied, default to requiring MFA
        companyRequiresMfa = true;
      }
    } else {
      // Default to requiring MFA if no company
      companyRequiresMfa = true;
    }

    // Generate and send OTP for MFA (even for Google users)
    const otpCode = OtpGeneratorUtil.generateOTP();
    const otpExpiresAt = OtpGeneratorUtil.generateOTPExpiration(10);

    await this.userRepository.update(user.id, {
      otpCode,
      otpExpiresAt,
      mfaEnabled: true,
    });

    await this.emailService.sendOTP(user.email, otpCode);

    const response: any = {
      requiresMfa: true,
      message: user.totpEnabled
        ? 'Use your authenticator app or check your email for OTP'
        : 'OTP sent to your email',
      tempToken: await this.generateTempToken(user.id),
    };

    if (user.totpEnabled) {
      response.totpEnabled = true;
      response.mfaMethods = ['totp', 'email'];
    } else {
      response.mfaMethods = ['email'];
    }

    return response;
  }

  async switchEnvironment(userId: string, switchDto: SwitchEnvironmentDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['companies'],
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Validate company access if provided
    if (switchDto.companyId) {
      const hasAccess = user.companies?.some(
        (c) => c.id === switchDto.companyId,
      );
      if (!hasAccess) {
        throw new BadRequestException('Access denied to company');
      }
      await this.userRepository.update(userId, {
        currentCompanyId: switchDto.companyId,
      });
    }

    await this.userRepository.update(userId, {
      currentEnvironment: switchDto.environment,
    });

    // Generate new JWT with updated environment
    const updatedUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!updatedUser) {
      throw new UnauthorizedException('User not found');
    }

    const companyId =
      switchDto.companyId || updatedUser.currentCompanyId || undefined;

    const payload = await this.buildJwtPayload(
      userId,
      companyId,
      switchDto.environment,
      updatedUser.email,
      updatedUser.roles || [],
      updatedUser.permissions || [],
    );
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      currentEnvironment: switchDto.environment,
      currentCompanyId: companyId,
    };
  }

  private async buildJwtPayload(
    userId: string,
    companyId: string | undefined,
    environment: Environment,
    email: string,
    roles: string[],
    permissions: string[],
  ) {
    return {
      userId,
      companyId: companyId || null,
      environment,
      email,
      roles,
      permissions,
      iat: Math.floor(Date.now() / 1000),
    };
  }

  async generateTempToken(userId: string): Promise<string> {
    return this.jwtService.sign(
      { userId, type: 'mfa-temp' },
      { expiresIn: '10m' }, // Increased to 10 minutes for OTP
    );
  }

  private async handleFailedLogin(user: User) {
    const failedAttempts = (user.failedLoginAttempts || 0) + 1;
    const updateData: any = {
      failedLoginAttempts: failedAttempts,
    };

    // Lock account after 5 failed attempts for 30 minutes
    if (failedAttempts >= 5) {
      updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }

    await this.userRepository.update(user.id, updateData);
  }

  /**
   * Setup TOTP for authenticator app
   */
  async setupTotp(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.totpEnabled) {
      throw new BadRequestException('Authenticator app is already enabled');
    }

    const secret = this.totpService.generateSecret(user.email);
    const qrCode = await this.totpService.generateQRCode(secret, user.email);

    return {
      qrCode,
      secret, // Temporary - user should verify before enabling
      manualEntryKey: secret,
    };
  }

  /**
   * Enable TOTP after verification
   */
  async enableTotp(userId: string, code: string, secret: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.totpEnabled) {
      throw new BadRequestException('Authenticator app is already enabled');
    }

    // Verify the code with the provided secret
    const isValid = this.totpService.verifyToken(code, secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    // Store the secret and enable TOTP
    await this.userRepository.update(user.id, {
      totpSecret: secret,
      totpEnabled: true,
    });

    return {
      message: 'Authenticator app enabled successfully',
    };
  }

  /**
   * Disable TOTP
   */
  async disableTotp(userId: string, code: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('Authenticator app is not enabled');
    }

    // Verify the code before disabling
    const isValid = this.totpService.verifyToken(code, user.totpSecret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    // Clear the secret and disable TOTP
    await this.userRepository.update(user.id, {
      totpSecret: null,
      totpEnabled: false,
    });

    return {
      message: 'Authenticator app disabled successfully',
    };
  }
}
