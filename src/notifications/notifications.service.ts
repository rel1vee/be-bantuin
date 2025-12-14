import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as webPush from 'web-push';
import type { PrismaClient, User } from '@prisma/client';

type NotificationData = {
  userId: string;
  content: string;
  link?: string;
  type?: string;
  emailSubject?: string;
};

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class NotificationsService implements OnModuleInit {
  private transporter: nodemailer.Transporter;
  private frontendUrl: string;
  // Fallback in-memory storage
  private tempSubscriptions: Map<string, any[]> = new Map();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  async onModuleInit() {
    // Baca konfigurasi dari ENV
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    // Konfigurasi NodeMailer Transporter
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<boolean>('SMTP_SECURE') === true,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });

    try {
      await this.transporter.verify();
      console.log('✅ SMTP Server Ready: Email notifications are enabled.');
    } catch (error) {
      console.error('❌ SMTP Connection Error: Email notifications are disabled.', error);
    }

    // Web Push Init
    const vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const vapidSubject = this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@bantuin.com';

    if (vapidPublicKey && vapidPrivateKey) {
      webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      console.log('✅ Web Push initialized');
    }
  }

  async subscribe(userId: string, subscription: any) {
    // In-memory Save
    const userSubs = this.tempSubscriptions.get(userId) || [];
    const existsInMemory = userSubs.some(s => s.endpoint === subscription.endpoint);
    if (!existsInMemory) {
      userSubs.push(subscription);
      this.tempSubscriptions.set(userId, userSubs);
      console.log(`[Push] Subscribed user ${userId} (In-Memory). Total: ${userSubs.length}`);
    }

    try {
      // Use any cast because PrismaClient might not be regenerated yet
      const pushSub = (this.prisma as any).pushSubscription;
      if (!pushSub) return;

      const existing = await pushSub.findFirst({
        where: { endpoint: subscription.endpoint, userId }
      });

      if (!existing) {
        await pushSub.create({
          data: {
            userId,
            endpoint: subscription.endpoint,
            keys: subscription.keys
          }
        });
      }
    } catch (e) {
      console.error('Push subscription failed (DB):', e.message);
    }
  }

  async unsubscribe(userId: string, endpoint: string) {
    // In-memory Remove
    const userSubs = this.tempSubscriptions.get(userId) || [];
    const filteredCtx = userSubs.filter(s => s.endpoint !== endpoint);
    this.tempSubscriptions.set(userId, filteredCtx);

    try {
      const pushSub = (this.prisma as any).pushSubscription;
      if (!pushSub) return;

      await pushSub.deleteMany({
        where: {
          userId,
          endpoint
        }
      });
    } catch (e) {
      console.error('Push unsubscribe failed (DB):', e.message);
    }
  }

  private async sendPushNotification(user: User, data: NotificationData) {
    try {
      let subscriptions: any[] = [];
      const pushSub = (this.prisma as any).pushSubscription;

      // 1. Try DB
      if (pushSub) {
        try {
          subscriptions = await pushSub.findMany({ where: { userId: user.id } });
        } catch (e) {
          console.warn('Failed to fetch subs from DB, using memory only');
        }
      }

      // 2. Fetch In-Memory (Merge)
      const memSubs = this.tempSubscriptions.get(user.id) || [];

      // Merge: create map by endpoint
      const allSubsMap = new Map();
      subscriptions.forEach(s => allSubsMap.set(s.endpoint, s));
      memSubs.forEach(s => allSubsMap.set(s.endpoint, s));

      const finalSubs = Array.from(allSubsMap.values());
      console.log(`[Push-Debug] User ${user.id} has ${finalSubs.length} subs (DB: ${subscriptions.length}, Mem: ${memSubs.length})`);

      if (finalSubs.length === 0) return;

      const payload = JSON.stringify({
        title: 'Bantuin',
        body: data.content,
        url: `${this.frontendUrl}${data.link || '/notifications'}`,
        icon: '/logo.svg' // Corrected icon path
      });

      for (const sub of finalSubs) {
        try {
          await webPush.sendNotification({
            endpoint: sub.endpoint,
            keys: sub.keys as any
          }, payload);
          console.log('[Push] Notification sent to endpoint.');
        } catch (e: any) {
          console.error('[Push] Send Error:', e.statusCode, e.body);
          if (e.statusCode === 410 || e.statusCode === 404) {
            // Remove from DB if exists
            if (pushSub) await pushSub.delete({ where: { id: sub.id } }).catch(() => { });
            // Remove from memory
            this.unsubscribe(user.id, sub.endpoint);
          }
        }
      }
    } catch (e) {
      console.error('Error sending push notification:', e);
    }
  }

  private async sendEmailNotification(user: User, data: NotificationData) {
    if (!user.email || !this.transporter) return;

    const defaultSubject = `[Bantuin] Notifikasi Baru (${data.type || 'UMUM'})`;
    const subject = data.emailSubject || defaultSubject;
    const notifLink = `${this.frontendUrl}${data.link || '/notifications'}`;

    try {
      await this.transporter.sendMail({
        from: `"Bantuin Notifikasi" <${this.transporter.options.auth?.user}>`,
        to: user.email,
        subject: subject,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #2f4550;">Halo ${user.fullName},</h2>
            <p style="font-size: 16px;">Anda memiliki notifikasi baru dari Bantuin:</p>
            <div style="border-left: 3px solid #586f7c; padding-left: 15px; margin: 15px 0;">
                <p style="font-size: 15px; color: #333; margin: 0;">${data.content}</p>
            </div>
            <a href="${notifLink}" style="display: inline-block; padding: 10px 20px; margin-top: 20px; background-color: #2f4550; color: white; text-decoration: none; border-radius: 5px;">
                Lihat di Aplikasi
            </a>
            <p style="margin-top: 30px; font-size: 12px; color: #999;">
                Ini adalah email otomatis.
            </p>
          </div>
        `,
      });
      console.log(`[EMAIL] Notifikasi berhasil dikirim ke ${user.email}`);
    } catch (error) {
      console.error(`[EMAIL ERROR] Gagal mengirim email ke ${user.email}. Pastikan kredensial SMTP benar.`, error);
    }
  }

  async create(data: NotificationData) {
    console.log(`[Notification] create() called for User ${data.userId} (Type: ${data.type})`);
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        console.warn(`[Notification] User ${data.userId} not found for notification.`);
        return;
      }

      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });

      void this.sendEmailNotification(user, data);
      void this.sendPushNotification(user, data);

    } catch (error) {
      console.error('Failed to create notification to DB:', error);
    }
  }

  async createInTx(tx: Tx, data: NotificationData) {
    console.log(`[Notification] createInTx() called for User ${data.userId} (Type: ${data.type})`);
    try {
      await tx.notification.create({
        data: {
          userId: data.userId,
          content: data.content,
          link: data.link,
          type: data.type,
        },
      });

      const user = await tx.user.findUnique({ where: { id: data.userId } });
      if (user) {
        this.sendEmailNotification(user, data).catch(err => console.error('[Async Email Error]', err));
        this.sendPushNotification(user, data).catch(err => console.error('[Async Push Error]', err));
      } else {
        console.warn(`User ${data.userId} not found for inTx email.`);
      }

    } catch (error) {
      console.error('Error creating notification in TX:', error);
    }
  }

  /**
   * Mengirim notifikasi eksternal (Push & Email) TANPA menyimpan ke database Notification (Lonceng).
   * Digunakan untuk Chat agar tidak spam di list notifikasi aplikasi.
   */
  async sendExternalNotification(user: User, data: NotificationData) {
    console.log(`[Notification] sendExternalNotification() called for User ${user.id} (Type: ${data.type})`);
    this.sendEmailNotification(user, data).catch(err => console.error('[Async Email Error]', err));
    this.sendPushNotification(user, data).catch(err => console.error('[Async Push Error]', err));
  }
}