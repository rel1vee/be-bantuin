import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as midtransClient from 'midtrans-client';
import type { Order, User } from '@prisma/client';
import { createHmac } from 'crypto';

@Injectable()
export class PaymentsService {
  private snap: midtransClient.Snap;
  private midtransServerKey: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {
    this.midtransServerKey = this.configService.get<string>(
      'MIDTRANS_SERVER_KEY',
    )!;

    // Validasi environment variable
    if (!this.midtransServerKey) {
      throw new Error('MIDTRANS_SERVER_KEY is not configured');
    }

    const clientKey = this.configService.get<string>('MIDTRANS_CLIENT_KEY')!;
    if (!clientKey) {
      throw new Error('MIDTRANS_CLIENT_KEY is not configured');
    }

    this.snap = new midtransClient.Snap({
      isProduction: false, // Pastikan false untuk Sandbox
      serverKey: this.midtransServerKey,
      clientKey: clientKey,
    });
  }

  /**
   * Membuat sesi pembayaran Midtrans Snap
   */
  async createPayment(order: Order, user: User) {
    try {
      // Validasi input
      if (!order || !order.id) {
        throw new BadRequestException('Invalid order data');
      }

      if (!user || !user.email) {
        throw new BadRequestException('Invalid user data');
      }

      // Validasi harga & Konversi ke Integer
      // Midtrans (IDR) tidak menerima desimal
      const amount = Math.round(order.price.toNumber());

      if (!amount || amount <= 0) {
        throw new BadRequestException('Invalid order amount');
      }

      // Cek jika sudah ada payment pending dengan token valid
      const existingPayment = await this.prisma.payment.findUnique({
        where: { orderId: order.id },
      });

      if (existingPayment && existingPayment.status === 'PENDING') {
        // Jika token masih ada dan belum expired, gunakan yang lama
        if (
          existingPayment.gatewayToken &&
          existingPayment.gatewayRedirectUrl
        ) {
          console.log('Reusing existing payment token for order:', order.id);
          return {
            token: existingPayment.gatewayToken,
            redirectUrl: existingPayment.gatewayRedirectUrl,
          };
        }
      }

      // --- SANITASI DATA (PENTING UNTUK MENGHINDARI ERROR MIDTRANS) ---

      // 1. Bersihkan Nama Item (Hapus Emoji dan karakter non-ascii)
      // Judul jasa sering mengandung emoji yang bisa membuat Midtrans error
      const safeItemName = order.title
        .replace(/[^\x00-\x7F]/g, '') // Hapus karakter non-ASCII (emoji, dll)
        .trim()
        .substring(0, 50); // Midtrans limit nama item 50 char

      // 2. Bersihkan Nomor Telepon
      // Midtrans lebih suka format 08xx atau 628xx tanpa simbol '+'
      let safePhone = user.phoneNumber || '081234567890';
      safePhone = safePhone.replace(/\+/g, '').trim();

      // 3. Pastikan Nama User tidak kosong
      const firstName = user.fullName
        ? user.fullName.split(' ')[0]
        : 'Customer';
      const lastName =
        user.fullName && user.fullName.split(' ').length > 1
          ? user.fullName.split(' ').slice(1).join(' ')
          : '';

      // Buat parameter Midtrans
      const parameter = {
        transaction_details: {
          order_id: order.id,
          gross_amount: amount,
        },
        customer_details: {
          first_name: firstName.substring(0, 20), // Limit char
          last_name: lastName.substring(0, 20), // Limit char
          email: user.email,
          phone: safePhone,
        },
        item_details: [
          {
            id: order.serviceId.substring(0, 50), // Pastikan ID tidak kepanjangan
            price: amount,
            quantity: 1,
            name: safeItemName || 'Jasa Bantuin', // Fallback jika nama kosong setelah sanitasi
          },
        ],
        enabled_payments: [
          'gopay',
          'shopeepay',
          'other_qris',
          'bank_transfer',
          'echannel',
          'bca_va',
          'bni_va',
          'bri_va',
          'permata_va',
          'other_va',
        ],
        callbacks: {
          finish: `${this.configService.get('FRONTEND_URL')}/buyer/orders/${order.id}`,
        },
      };

      console.log('Creating Midtrans transaction...');

      // Panggil Midtrans API
      const transaction = await this.snap.createTransaction(parameter);

      if (!transaction || !transaction.token || !transaction.redirect_url) {
        throw new InternalServerErrorException(
          'Midtrans API returned invalid response',
        );
      }

      const { token, redirect_url } = transaction;

      // Simpan/Update payment record di DB
      await this.prisma.payment.upsert({
        where: { orderId: order.id },
        update: {
          amount: order.price,
          status: 'PENDING',
          gatewayToken: token,
          gatewayRedirectUrl: redirect_url,
          updatedAt: new Date(),
        },
        create: {
          orderId: order.id,
          amount: order.price,
          status: 'PENDING',
          gateway: 'midtrans',
          gatewayToken: token,
          gatewayRedirectUrl: redirect_url,
        },
      });

      return { token, redirectUrl: redirect_url };
    } catch (error) {
      console.error('Midtrans Payment Creation Error:', {
        orderId: order.id,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error && typeof error === 'object' && 'ApiResponse' in error) {
        const apiError = error as any;
        console.error('Midtrans API Error Details:', apiError.ApiResponse);
      }

      throw new InternalServerErrorException(
        'Gagal membuat sesi pembayaran. Silakan coba lagi.',
      );
    }
  }

  /**
   * Memproses Webhook dari Midtrans
   */
  async handlePaymentWebhook(payload: Record<string, unknown>) {
    try {
      const order_id = payload.order_id as string;
      const transaction_status = payload.transaction_status as string;
      const transaction_id = payload.transaction_id as string;
      const status_code = payload.status_code as string;
      const gross_amount = payload.gross_amount as string;
      const signature_key = payload.signature_key as string;
      const payment_type = payload.payment_type as string;

      console.log(
        `Processing Webhook for Order: ${order_id}, Status: ${transaction_status}`,
      );

      // Validasi payload dasar
      if (!order_id || !transaction_status || !gross_amount || !signature_key) {
        throw new BadRequestException('Invalid webhook payload');
      }

      // 1. Verifikasi Signature Key
      const expectedSignature = this.verifySignature(
        order_id,
        status_code,
        gross_amount,
        this.midtransServerKey,
      );

      if (signature_key !== expectedSignature) {
        console.error('Invalid signature:', {
          received: signature_key,
          expected: expectedSignature,
        });
        throw new BadRequestException('Invalid signature');
      }

      // 2. Dapatkan payment record
      const payment = await this.prisma.payment.findUnique({
        where: { orderId: order_id },
      });

      if (!payment) {
        console.error(`Payment not found for Order ID: ${order_id}`);
        throw new NotFoundException('Payment record not found');
      }

      // 3. Idempotency Check
      if (
        payment.status === 'SETTLEMENT' &&
        transaction_status === 'settlement'
      ) {
        return { message: 'Payment already processed' };
      }

      // 4. Update status payment
      let updatedStatus = payment.status;

      if (transaction_status === 'capture') {
        // Untuk kartu kredit, cek fraud_status
        if (payload.fraud_status === 'challenge') {
          updatedStatus = 'PENDING'; // Challenge berarti belum pasti sukses
        } else if (payload.fraud_status === 'accept') {
          updatedStatus = 'SETTLEMENT';
        }
      } else if (transaction_status === 'settlement') {
        updatedStatus = 'SETTLEMENT';
      } else if (
        transaction_status === 'cancel' ||
        transaction_status === 'deny' ||
        transaction_status === 'expire'
      ) {
        updatedStatus = 'CANCELLED'; // Mapping ke Enum CANCELLED
      } else if (transaction_status === 'pending') {
        updatedStatus = 'PENDING';
      }

      // Update Database
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: updatedStatus,
          transactionId: transaction_id,
          paymentType: payment_type,
          updatedAt: new Date(),
        },
      });

      // 5. Emit event jika sukses
      if (updatedStatus === 'SETTLEMENT') {
        this.eventEmitter.emit('payment.settled', {
          orderId: order_id,
          transactionData: payload,
        });
      }

      return { message: `Payment status updated to ${updatedStatus}` };
    } catch (error) {
      console.error('Webhook processing error:', error);
      throw new InternalServerErrorException('Failed to process webhook');
    }
  }

  /**
   * Helper untuk verifikasi signature Midtrans
   */
  private verifySignature(
    orderId: string,
    statusCode: string,
    grossAmount: string,
    serverKey: string,
  ): string {
    const hash = createHmac('sha512', serverKey);
    hash.update(`${orderId}${statusCode}${grossAmount}${serverKey}`);
    return hash.digest('hex');
  }
}
