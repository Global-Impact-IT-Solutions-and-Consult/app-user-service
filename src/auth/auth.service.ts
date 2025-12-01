import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { User, UserDocument, Environment } from '../users/schemas/user.schema';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { SwitchEnvironmentDto } from './dto/switch-environment.dto';
import { UsersService } from '../users/users.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
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

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on successful password check
    await this.userModel.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // Mandatory MFA - always required
    if (!user.mfaEnabled || !user.mfaSecret) {
      // Generate MFA secret if not exists
      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(
        user.email,
        'User Service',
        secret,
      );

      await this.userModel.findByIdAndUpdate(user._id, {
        $set: {
          mfaSecret: secret,
          mfaEnabled: true,
        },
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

      return {
        requiresMfa: true,
        mfaSecret: secret,
        qrCodeUrl,
        tempToken: await this.generateTempToken(user._id.toString()),
      };
    }

    return {
      requiresMfa: true,
      tempToken: await this.generateTempToken(user._id.toString()),
    };
  }

  async verifyMfa(mfaVerifyDto: MfaVerifyDto) {
    const user = await this.userModel
      .findById(mfaVerifyDto.userId)
      .populate('companies');

    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('Invalid MFA session');
    }

    const isValid = authenticator.verify({
      token: mfaVerifyDto.code,
      secret: user.mfaSecret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    // Set default environment to TEST if not set
    let currentEnvironment = user.currentEnvironment || Environment.TEST;

    // Set default company if user has companies
    let currentCompanyId: Types.ObjectId | undefined = user.currentCompanyId;
    if (!currentCompanyId && user.companies && user.companies.length > 0) {
      currentCompanyId = user.companies[0] as Types.ObjectId;
    }

    // Update user
    await this.userModel.findByIdAndUpdate(user._id, {
      $set: {
        currentEnvironment,
        currentCompanyId,
        lastLoginAt: new Date(),
      },
    });

    // Generate JWT with environment scope
    const payload = await this.buildJwtPayload(
      user._id.toString(),
      currentCompanyId?.toString(),
      currentEnvironment,
      user.email,
      user.roles || [],
      user.permissions || [],
    );
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        currentEnvironment,
        currentCompanyId: currentCompanyId?.toString(),
      },
    };
  }

  async switchEnvironment(userId: string, switchDto: SwitchEnvironmentDto) {
    const user = await this.userModel.findById(userId).populate('companies');

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Validate company access if provided
    if (switchDto.companyId) {
      const hasAccess = user.companies?.some(
        (c) => c.toString() === switchDto.companyId,
      );
      if (!hasAccess) {
        throw new BadRequestException('Access denied to company');
      }
      await this.userModel.findByIdAndUpdate(userId, {
        $set: { currentCompanyId: switchDto.companyId },
      });
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $set: { currentEnvironment: switchDto.environment },
    });

    // Generate new JWT with updated environment
    const updatedUser = await this.userModel.findById(userId);
    if (!updatedUser) {
      throw new UnauthorizedException('User not found');
    }

    const companyId =
      switchDto.companyId || updatedUser.currentCompanyId?.toString();

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

  private async generateTempToken(userId: string): Promise<string> {
    return this.jwtService.sign(
      { userId, type: 'mfa-temp' },
      { expiresIn: '5m' },
    );
  }

  private async handleFailedLogin(user: UserDocument) {
    const failedAttempts = (user.failedLoginAttempts || 0) + 1;
    const updateData: any = {
      failedLoginAttempts: failedAttempts,
    };

    // Lock account after 5 failed attempts for 30 minutes
    if (failedAttempts >= 5) {
      updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }

    await this.userModel.findByIdAndUpdate(user._id, { $set: updateData });
  }
}
