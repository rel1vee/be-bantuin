import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { GetUser } from './decorators/get-user.decorator';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { GoogleUserDto } from './dto/google-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(@Req() req: Request, @Res() res: Response) {
    try {
      const googleUser = req.user as GoogleUserDto;

      const result = await this.authService.googleLogin({
        email: googleUser.email,
        fullName: googleUser.fullName,
        picture: googleUser.picture,
        googleId: googleUser.googleId,
        nim: googleUser.nim,
        major: googleUser.major,
        batch: googleUser.batch,
      });

      // 1. Tentukan Tujuan Redirect (Frontend URL)
      // Default ambil dari ENV
      let frontendUrl = this.configService.get<string>('FRONTEND_URL')!;

      // Cek apakah ada 'state' yang membawa returnUrl dinamis
      if (req.query.state) {
        try {
          const stateJson = JSON.parse(
            Buffer.from(req.query.state as string, 'base64').toString(),
          );
          if (stateJson.returnUrl) {
            frontendUrl = stateJson.returnUrl;
            console.log('Dynamic redirect to:', frontendUrl);
          }
        } catch (error) {
          console.error('Failed to parse OAuth state:', error);
        }
      }

      // Pastikan tidak ada trailing slash
      frontendUrl = frontendUrl.replace(/\/$/, '');

      // Redirect dengan token
      const redirectUrl = `${frontendUrl}/auth/callback?token=${result.access_token}`;
      return res.redirect(redirectUrl);
    } catch (error) {
      // Gunakan frontendUrl default dari env untuk error fallback
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const errorMessage =
        error instanceof Error ? error.message : 'Authentication failed';
      return res.redirect(
        `${frontendUrl}/auth/error?message=${encodeURIComponent(errorMessage)}`,
      );
    }
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@GetUser() user: User) {
    return {
      statusCode: 200,
      message: 'Profile retrieved successfully',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        nim: user.nim,
        major: user.major,
        batch: user.batch,
        phoneNumber: user.phoneNumber,
        profilePicture: user.profilePicture,
        bio: user.bio,
        isSeller: user.isSeller,
        isVerified: user.isVerified,
        avgRating: user.avgRating,
        totalReviews: user.totalReviews,
        totalOrdersCompleted: user.totalOrdersCompleted,
        createdAt: user.createdAt,
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout() {
    // Guard sudah memastikan user terautentikasi.
    // Jika logic logout tidak butuh data user, hapus saja.
    return {
      statusCode: 200,
      message: 'Logged out successfully',
    };
  }

  @Public()
  @Get('health')
  healthCheck() {
    return {
      statusCode: 200,
      message: 'Auth service is running',
      timestamp: new Date().toISOString(),
    };
  }
}
