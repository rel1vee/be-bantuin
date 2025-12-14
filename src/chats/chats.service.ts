import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ChatsGateway } from './chats.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateConversationDto } from './dto/chat.dto';
import type { SendMessageDto } from './dto/chat.dto';
import type { PrismaClient } from '@prisma/client';

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ChatsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    @Inject(forwardRef(() => ChatsGateway))
    private chatsGateway: ChatsGateway, // Inject Gateway
  ) { }

  /**
   * [REST] Mendapatkan atau Membuat Obrolan Baru
   */
  async findOrCreateConversation(senderId: string, dto: CreateConversationDto) {
    const { recipientId, initialMessage } = dto;

    if (senderId === recipientId) {
      throw new BadRequestException(
        'Anda tidak dapat mengirim pesan ke diri sendiri',
      );
    }

    // Cek apakah obrolan antara 2 user ini sudah ada
    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: senderId } } },
          { participants: { some: { userId: recipientId } } },
        ],
      },
    });

    if (existingConversation) {
      // Obrolan sudah ada, kirim pesan awal ke sana
      const message = await this.saveMessage(senderId, {
        conversationId: existingConversation.id,
        content: initialMessage,
      });
      return { conversation: existingConversation, message, isNew: false };
    }

    // Buat obrolan baru jika belum ada
    return this.prisma.$transaction(async (tx) => {
      const newConversation = await tx.conversation.create({
        data: {},
      });

      // Tambahkan kedua peserta
      await tx.conversationParticipant.createMany({
        data: [
          { userId: senderId, conversationId: newConversation.id },
          { userId: recipientId, conversationId: newConversation.id },
        ],
      });

      // Simpan pesan awal
      const message = await this.saveMessageInTx(tx, senderId, {
        conversationId: newConversation.id,
        content: initialMessage,
      });

      // Update lastMessageId di Conversation
      await tx.conversation.update({
        where: { id: newConversation.id },
        data: { lastMessageId: message.id },
      });

      return { conversation: newConversation, message, isNew: true };
    });
  }

  /**
   * [WebSocket] Menyimpan pesan baru
   */
  async saveMessage(senderId: string, dto: SendMessageDto) {
    return this.prisma.$transaction(async (tx) => {
      return this.saveMessageInTx(tx, senderId, dto);
    });
  }

  /**
   * [Internal] Helper untuk menyimpan pesan di dalam transaksi
   */
  async saveMessageInTx(tx: PrismaTx, senderId: string, dto: SendMessageDto) {
    const { conversationId, content } = dto;

    // 1. Simpan pesan
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId,
        content,
      },
      include: {
        sender: {
          // Sertakan info pengirim untuk di-broadcast
          select: { id: true, fullName: true, profilePicture: true },
        },
      },
    });

    // 2. Update 'updatedAt' dan 'lastMessageId' di Conversation
    // Ini akan menaikkan obrolan ke atas di inbox
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        lastMessageId: message.id,
      },
    });

    // 3. Kirim Notifikasi Eksternal (Push & Email) SAJA
    // Kita TIDAK membuat record di tabel `Notification` agar tidak muncul di lonceng (Bell).
    const participants = await tx.conversationParticipant.findMany({
      where: {
        conversationId,
        NOT: { userId: senderId },
      },
      include: { user: true },
    });

    for (const p of participants) {
      // Panggil method baru di NotificationsService untuk push/email tanpa simpan DB
      this.notificationsService.sendExternalNotification(p.user, {
        userId: p.userId,
        content: `Pesan baru dari ${message.sender.fullName}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''
          }`,
        type: 'CHAT',
        link: `/chat?id=${conversationId}`,
      });
    }

    // 4. [FIX] Broadcast Real-Time via Socket
    const recipientIds = await this.getRecipientIds(conversationId, senderId);
    // Broadcast ke lawan bicara
    for (const id of recipientIds) {
      this.chatsGateway.broadcastMessage(id, message);
    }
    // Broadcast ke diri sendiri (untuk konfirmasi/update UI)
    this.chatsGateway.broadcastMessage(senderId, message);

    return message;
  }

  /**
   * [REST] Mendapatkan semua obrolan (Inbox)
   */
  /**
   * [REST] Mendapatkan semua obrolan (Inbox) dengan hitungan pesan belum dibaca
   */
  async getMyConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        lastMessage: {
          include: {
            sender: { select: { fullName: true } },
          },
        },
        participants: {
          where: { NOT: { userId } },
          include: {
            user: {
              select: { id: true, fullName: true, profilePicture: true },
            },
          },
        },
        messages: {
          where: {
            isRead: false,
            senderId: { not: userId },
          },
          select: { id: true },
        },
      },
    });

    return conversations.map((c) => ({
      ...c,
      unreadCount: c.messages.length,
      messages: undefined, // remove raw array
    }));
  }

  /**
   * [REST/Socket] Tandai semua pesan di obrolan sebagai sudah dibaca
   */
  async markConversationAsRead(userId: string, conversationId: string) {
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId }, // Hanya pesan dari orang lain
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
    return { success: true };
  }

  /**
   * [WebSocket] Mendapatkan riwayat pesan
   */
  async getMessageHistory(userId: string, conversationId: string) {
    // Validasi apakah user adalah peserta
    const isParticipant = await this.prisma.conversationParticipant.count({
      where: { userId, conversationId },
    });

    if (isParticipant === 0) {
      throw new ForbiddenException('Akses ditolak');
    }

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, fullName: true, profilePicture: true },
        },
      },
    });
  }

  /**
   * [Helper] Mendapatkan ID peserta lain dalam obrolan
   */
  async getRecipientIds(
    conversationId: string,
    senderId: string,
  ): Promise<string[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        NOT: { userId: senderId },
      },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }
}
