import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { ActivateSellerDto } from './dto/activate-seller.dto';
import { RequestPhoneVerificationDto, VerifyPhoneDto } from './dto/phone-verification.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('profile')
  async getProfile(@GetUser('id') userId: string) {
    const user = await this.usersService.findById(userId);
    return {
      success: true,
      data: user,
    };
  }

  @Patch('profile')
  async updateProfile(
    @GetUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.usersService.updateProfile(userId, dto);
    return {
      success: true,
      message: 'Profil berhasil diperbarui',
      data: user,
    };
  }

  @Post('activate-seller')
  @HttpCode(HttpStatus.OK)
  async activateSeller(
    @GetUser('id') userId: string,
    @Body() dto: ActivateSellerDto,
  ) {
    const user = await this.usersService.activateSeller(
      userId,
      dto.phoneNumber,
      dto.bio,
    );
    return {
      success: true,
      message: 'Berhasil menjadi penyedia jasa',
      data: user,
    };
  }

  @Get('seller/stats')
  async getSellerStats(@GetUser('id') userId: string) {
    const stats = await this.usersService.getSellerStats(userId);
    return {
      success: true,
      data: stats,
    };
  }

  @Public() // <--- Tambahkan ini agar bisa diakses di Landing Page
  @Get('top-sellers')
  async getTopSellers() {
    const sellers = await this.usersService.getTopSellers();
    return {
      success: true,
      data: sellers,
    };
  }

  @Post('request-phone-verification')
  async requestPhoneVerification(
    @GetUser('id') userId: string,
    @Body() dto: RequestPhoneVerificationDto,
  ) {
    return this.usersService.requestPhoneVerification(userId, dto.phoneNumber);
  }

  @Post('verify-phone')
  async verifyPhone(
    @GetUser('id') userId: string,
    @Body() dto: VerifyPhoneDto,
  ) {
    const user = await this.usersService.verifyPhone(userId, dto.otp);
    return {
      success: true,
      message: 'Nomor telepon berhasil diverifikasi',
      data: user,
    };
  }
}
