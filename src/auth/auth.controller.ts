import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  HttpCode,
  HttpStatus,
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
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

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
  @ApiOperation({ summary: 'User registration' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async signup(@Body() signupDto: SignupDto) {
    const user = await this.usersService.create(signupDto);
    return {
      message: 'User created successfully. Please complete MFA setup.',
      userId: user._id.toString(),
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login (triggers MFA)' })
  @ApiResponse({
    status: 200,
    description: 'Login successful, MFA required',
    schema: {
      example: {
        requiresMfa: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP',
        qrCodeUrl: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
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
  @ApiOperation({ summary: 'Verify MFA code' })
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
  @ApiResponse({ status: 401, description: 'Invalid MFA code' })
  async verifyMfa(@Body() mfaVerifyDto: MfaVerifyDto) {
    return this.authService.verifyMfa(mfaVerifyDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch-environment')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Switch between Test and Live environments' })
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
      throw new Error('User not found');
    }

    return {
      id: userDoc._id.toString(),
      email: userDoc.email,
      currentEnvironment: userDoc.currentEnvironment,
      currentCompanyId: userDoc.currentCompanyId?.toString(),
      companies: userDoc.companies?.map((c: any) => ({
        id: c._id?.toString() || c.toString(),
        name: c.name,
      })),
      roles: userDoc.roles,
      permissions: userDoc.permissions,
      isEmailVerified: userDoc.isEmailVerified,
    };
  }
}

