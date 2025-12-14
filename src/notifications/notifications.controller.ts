import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard) // Amankan semua endpoint
export class NotificationsController {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) { }

  /**
   * [User] Mendapatkan semua notifikasi (terbaru dulu)
   * GET /api/notifications
   */
  @Get()
  async getMyNotifications(@GetUser('id') userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50, // Batasi 50 terbaru
    });
    return {
      success: true,
      data: notifications,
    };
  }

  /**
   * [User] Mendapatkan jumlah notifikasi yang belum dibaca
   * GET /api/notifications/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(@GetUser('id') userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return {
      success: true,
      data: { count },
    };
  }

  /**
   * [User] Menandai satu notifikasi sebagai 'sudah dibaca'
   * POST /api/notifications/:id/read
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @GetUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId, // Pastikan user hanya bisa update notif miliknya
      },
      data: { isRead: true },
    });
    return {
      success: true,
      message: 'Notifikasi ditandai telah dibaca',
    };
  }

  /**
   * [User] Menandai semua notifikasi sebagai 'sudah dibaca'
   * POST /api/notifications/read-all
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@GetUser('id') userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return {
      success: true,
      message: 'Semua notifikasi ditandai telah dibaca',
    };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  async subscribe(
    @GetUser('id') userId: string,
    @Body() subscription: any,
  ) {
    await this.notificationsService.subscribe(userId, subscription);
    return { success: true };
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @GetUser('id') userId: string,
    @Body() body: { endpoint: string },
  ) {
    await this.notificationsService.unsubscribe(userId, body.endpoint);
    return { success: true };
  }

  @Post('test-push')
  @HttpCode(HttpStatus.OK)
  async testPush(@GetUser('id') userId: string) {
    await this.notificationsService.create({
      userId,
      content: 'Halo! Ini adalah tes notifikasi dari sistem Bantuin.',
      type: 'SYSTEM',
      link: '/notifications'
    });
    return { success: true, message: 'Notifikasi tes dikirim' };
  }
}
