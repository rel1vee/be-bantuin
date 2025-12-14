import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';

import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        coverPicture: true,
        socialMedia: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    return user;
  }

  async findByEmail(email: string) {
    return await this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findPublicProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        profilePicture: true,
        coverPicture: true,
        socialMedia: true,
        bio: true,
        major: true,
        batch: true,
        isSeller: true,
        isVerified: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    return user;
  }


  async activateSeller(userId: string, phoneNumber: string, bio: string) {
    // Check if user exists
    const user = await this.findById(userId);

    // Check if already a seller
    if (user.isSeller) {
      throw new ConflictException('Anda sudah terdaftar sebagai penyedia jasa');
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new BadRequestException(
        'Anda harus memverifikasi email terlebih dahulu',
      );
    }

    // Validate phone number length
    if (!phoneNumber || phoneNumber.length < 10) {
      throw new BadRequestException('Nomor telepon minimal 10 digit');
    }

    // Validate bio length
    if (!bio || bio.length < 50) {
      throw new BadRequestException('Bio minimal 50 karakter');
    }

    // Normalize phone number (convert to +62 format)
    let normalizedPhone = phoneNumber;
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '+62' + normalizedPhone.substring(1);
    } else if (normalizedPhone.startsWith('62')) {
      normalizedPhone = '+' + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+62')) {
      normalizedPhone = '+62' + normalizedPhone;
    }

    // Update user to become seller
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isSeller: true,
        phoneNumber: normalizedPhone,
        bio: bio,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        coverPicture: true,
        socialMedia: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updatedUser;
  }

  async updateProfile(userId: string, updateData: Prisma.UserUpdateInput) {
    // Verify user exists
    await this.findById(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        coverPicture: true,
        socialMedia: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updatedUser;
  }

  async getSellerStats(userId: string) {
    const user = await this.findById(userId);

    if (!user.isSeller) {
      throw new BadRequestException('User bukan penyedia jasa');
    }

    // Get seller services
    const services = await this.prisma.service.findMany({
      where: {
        sellerId: userId,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        price: true,
        totalOrders: true,
        avgRating: true,
        status: true,
      },
    });

    // Get orders as seller (through services)
    const serviceIds = services.map((s) => s.id);

    const [activeOrders, completedOrders, totalRevenue] = await Promise.all([
      // Active orders
      this.prisma.order.count({
        where: {
          serviceId: { in: serviceIds },
          status: { in: ['DRAFT', 'IN_PROGRESS', 'DELIVERED'] },
        },
      }),
      // Completed orders
      this.prisma.order.count({
        where: {
          serviceId: { in: serviceIds },
          status: 'COMPLETED',
        },
      }),
      // Total revenue (completed orders only)
      this.prisma.order.aggregate({
        where: {
          serviceId: { in: serviceIds },
          status: 'COMPLETED',
        },
        _sum: {
          price: true,
        },
      }),
    ]);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        avgRating: user.avgRating,
        totalReviews: user.totalReviews,
        totalOrdersCompleted: user.totalOrdersCompleted,
      },
      stats: {
        totalServices: services.length,
        activeOrders,
        completedOrders,
        totalRevenue: totalRevenue._sum.price || 0,
      },
      services,
    };
  }

  async getTopSellers() {
    return this.prisma.user.findMany({
      where: {
        isSeller: true,
        status: 'active',
        totalOrdersCompleted: { gt: 0 }, // Minimal pernah menyelesaikan 1 order
      },
      orderBy: {
        totalOrdersCompleted: 'desc',
      },
      take: 4,
      select: {
        id: true,
        fullName: true,
        profilePicture: true,
        major: true,
        bio: true,
        avgRating: true,
        totalOrdersCompleted: true,
      },
    });
  }

  // --- Phone Verification Logic ---

  // In-memory store for OTP (userId -> { otp: string, phoneNumber: string, expiresAt: number })
  // Note: In production, use Redis.
  private otpStore = new Map<
    string,
    { otp: string; phoneNumber: string; expiresAt: number }
  >();

  async requestPhoneVerification(userId: string, phoneNumber: string) {
    // 1. Normalize phone number
    let normalizedPhone = phoneNumber;
    if (normalizedPhone.startsWith('0')) {
      normalizedPhone = '+62' + normalizedPhone.substring(1);
    } else if (normalizedPhone.startsWith('62')) {
      normalizedPhone = '+' + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+62')) {
      normalizedPhone = '+62' + normalizedPhone;
    }

    // 2. Generate OTP
    const otp = randomInt(100000, 999999).toString();

    // 3. Store OTP (expires in 5 minutes)
    this.otpStore.set(userId, {
      otp,
      phoneNumber: normalizedPhone,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // 4. Send OTP via Fonnte API
    const fonnteToken = this.configService.get<string>('FONNTE_TOKEN');
    if (fonnteToken) {
      try {
        const formData = new FormData();
        formData.append('target', normalizedPhone);
        formData.append(
          'message',
          `*Bantuin App*\n\nKode Verifikasi Anda: *${otp}*\n\nJangan berikan kode ini kepada siapapun. Kode berlaku selama 5 menit.`,
        );

        const response = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            Authorization: fonnteToken,
          },
          body: formData,
        });

        const result = await response.json();
        console.log('[FONNTE] Response:', result);
      } catch (error) {
        console.error('[FONNTE] Error sending OTP:', error);
        // Fallback to console log if API fails
        console.log(`[WHATSAPP MOCK BACKUP] OTP: ${otp}`);
      }
    } else {
      console.warn('[FONNTE] Token not found in env, using mock logger');
      console.log('================================================');
      console.log(`[WHATSAPP MOCK] Sending OTP to ${normalizedPhone}`);
      console.log(`OTP CODE: ${otp}`);
      console.log('================================================');
    }

    return {
      message: 'Kode verifikasi telah dikirim ke WhatsApp Anda',
      // developer_note removed for production-like feel, or keep if debugging
    };
  }

  async verifyPhone(userId: string, otp: string) {
    const stored = this.otpStore.get(userId);

    if (!stored) {
      throw new BadRequestException('Tidak ada permintaan verifikasi yang aktif');
    }

    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(userId);
      throw new BadRequestException('Kode verifikasi telah kadaluarsa');
    }

    if (stored.otp !== otp) {
      throw new BadRequestException('Kode verifikasi salah');
    }

    // Update User Phone Number
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneNumber: stored.phoneNumber,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        nim: true,
        major: true,
        batch: true,
        phoneNumber: true,
        profilePicture: true,
        coverPicture: true,
        socialMedia: true,
        bio: true,
        isVerified: true,
        isSeller: true,
        avgRating: true,
        totalReviews: true,
        totalOrdersCompleted: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Clear OTP
    this.otpStore.delete(userId);

    return updatedUser;
  }
}
