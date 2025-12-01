import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { SignupDto } from '../auth/dto/signup.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async create(signupDto: SignupDto): Promise<UserDocument> {
    // Check if user exists
    const existingUser = await this.userModel.findOne({ email: signupDto.email.toLowerCase() });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(signupDto.password, saltRounds);

    // Create user
    const user = new this.userModel({
      email: signupDto.email.toLowerCase(),
      passwordHash,
      mfaEnabled: false,
      isEmailVerified: false,
    });

    return user.save();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).populate('companies').exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).populate('companies').exec();
  }

  async update(userId: string, updates: Partial<User>): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(userId, updates, { new: true });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async addCompanyToUser(userId: string, companyId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { companies: companyId },
    });
  }
}

