import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { SignupDto } from './dto/signup.dto';
import { SwitchEnvironmentDto } from './dto/switch-environment.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SetupTotpResponseDto } from './dto/setup-totp.dto';
import { EnableTotpDto } from './dto/enable-totp.dto';
import { DisableTotpDto } from './dto/disable-totp.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @Post('signup')
  @ApiOperation({ summary: 'User registration (sends OTP to email)' })
  @ApiBody({ type: SignupDto })
  @ApiResponse({
    status: 201,
    description: 'User created successfully, OTP sent to email',
    schema: {
      example: {
        message: 'User created successfully. OTP sent to your email.',
        userId: '507f1f77bcf86cd799439011',
        requiresMfa: true,
        tempToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({ status: 409, description: 'User already exists' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async signup(@Body() signupDto: SignupDto) {
    const user = await this.usersService.create(signupDto);
    return {
      message: 'User created successfully. OTP sent to your email.',
      userId: user.id,
      requiresMfa: true,
      tempToken: await this.authService.generateTempToken(user.id),
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login (sends OTP to email for MFA)' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful, OTP sent to email',
    schema: {
      example: {
        requiresMfa: true,
        message: 'OTP sent to your email',
        tempToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Account locked' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post('verify-mfa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify MFA code (email OTP or authenticator app TOTP)' })
  @ApiBody({ type: MfaVerifyDto })
  @ApiResponse({
    status: 200,
    description: 'MFA verified, JWT token returned',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: '507f1f77bcf86cd799439011',
          email: 'user@example.com',
          currentEnvironment: 'test',
          currentCompanyId: '507f1f77bcf86cd799439012',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired MFA code' })
  async verifyMfa(@Body() mfaVerifyDto: MfaVerifyDto) {
    return this.authService.verifyMfa(mfaVerifyDto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 requests per minute
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP code to email' })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP resent to email',
    schema: {
      example: {
        message: 'OTP sent to your email',
        tempToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resendOTP(@Body() resendOtpDto: ResendOtpDto) {
    return this.authService.resendOTP(resendOtpDto.userId);
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @ApiResponse({ status: 302, description: 'Redirects to Google OAuth' })
  async googleAuth() {
    // This endpoint initiates the Google OAuth flow
    // Passport will handle the redirect
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback (sends OTP to email)' })
  @ApiResponse({
    status: 200,
    description: 'Google login successful, OTP sent to email',
    schema: {
      example: {
        requiresMfa: true,
        message: 'OTP sent to your email',
        tempToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  async googleAuthRedirect(@Req() req) {
    return this.authService.googleLogin(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch-environment')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Switch between Test and Live environments' })
  @ApiBody({ type: SwitchEnvironmentDto })
  @ApiResponse({
    status: 200,
    description: 'Environment switched successfully',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        currentEnvironment: 'live',
        currentCompanyId: '507f1f77bcf86cd799439012',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async switchEnvironment(
    @CurrentUser() user: CurrentUserPayload,
    @Body() switchDto: SwitchEnvironmentDto,
  ) {
    return this.authService.switchEnvironment(user.userId, switchDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    schema: {
      example: {
        id: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        currentEnvironment: 'test',
        currentCompanyId: '507f1f77bcf86cd799439012',
        companies: [
          {
            id: '507f1f77bcf86cd799439012',
            name: 'Acme Corporation',
          },
        ],
        roles: ['admin'],
        permissions: ['read', 'write'],
        isEmailVerified: true,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    const userDoc = await this.usersService.findById(user.userId);
    if (!userDoc) {
      throw new NotFoundException('User not found');
    }

    return {
      id: userDoc.id,
      email: userDoc.email,
      currentEnvironment: userDoc.currentEnvironment,
      currentCompanyId: userDoc.currentCompanyId,
      companies: userDoc.companies?.map((c) => ({
        id: c.id,
        name: c.name,
      })),
      roles: userDoc.roles,
      permissions: userDoc.permissions,
      isEmailVerified: userDoc.isEmailVerified,
      totpEnabled: userDoc.totpEnabled,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('mfa/setup')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Setup authenticator app (get QR code)' })
  @ApiResponse({
    status: 200,
    description: 'QR code and secret for authenticator app setup',
    type: SetupTotpResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Authenticator app already enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async setupTotp(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.setupTotp(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Enable authenticator app after verification' })
  @ApiBody({ type: EnableTotpDto })
  @ApiResponse({
    status: 200,
    description: 'Authenticator app enabled successfully',
    schema: {
      example: {
        message: 'Authenticator app enabled successfully',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Authenticator app already enabled' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code' })
  async enableTotp(
    @CurrentUser() user: CurrentUserPayload,
    @Body() enableTotpDto: EnableTotpDto,
  ) {
    return this.authService.enableTotp(
      user.userId,
      enableTotpDto.code,
      enableTotpDto.secret,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable authenticator app' })
  @ApiBody({ type: DisableTotpDto })
  @ApiResponse({
    status: 200,
    description: 'Authenticator app disabled successfully',
    schema: {
      example: {
        message: 'Authenticator app disabled successfully',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Authenticator app not enabled' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code' })
  async disableTotp(
    @CurrentUser() user: CurrentUserPayload,
    @Body() disableTotpDto: DisableTotpDto,
  ) {
    return this.authService.disableTotp(user.userId, disableTotpDto.code);
  }
}
