import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { AuthService } from '../auth/auth.service'; // Untuk validasi token
import { NotificationsService } from '../notifications/notifications.service';
import type { SendMessageDto } from './dto/chat.dto';
import type { User } from '@prisma/client';

interface SocketWithAuth extends Socket {
  data: {
    user: User;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*', // Ganti dengan FRONTEND_URL Anda di production
    credentials: true,
  },
  transports: ['polling', 'websocket'], // Support both for ngrok compatibility
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private connectedUsers: Map<string, Socket> = new Map();

  constructor(
    @Inject(forwardRef(() => ChatsService))
    private chatService: ChatsService,
    private authService: AuthService,
    private notificationService: NotificationsService,
  ) { }

  /**
   * Handle koneksi baru
   */
  async handleConnection(client: SocketWithAuth) {
    try {
      console.log(`🔌 [Socket] New connection attempt from ${client.id}`);

      // 1. Autentikasi user dari token
      const token = client.handshake.auth.token as string;
      if (!token) {
        console.error(`   ❌ No token provided`);
        throw new Error('No token provided');
      }

      // 2. Gunakan AuthService untuk validasi JWT
      // Ini jauh lebih clean dan terenkapsulasi
      const user = await this.authService.validateUserFromJwt(token);
      if (!user) {
        console.error(`   ❌ Invalid user`);
        throw new Error('Invalid user');
      }

      // 3. Simpan data user di socket
      client.data.user = user;
      this.connectedUsers.set(user.id, client);
      void client.join(user.id);

      // Broadcast status online ke semua orang (atau bisa dilimit ke teman chat saja)
      this.server.emit('userStatus', { userId: user.id, isOnline: true });

      console.log(`   ✅ Client authenticated: ${user.fullName} (${user.id})`);
      console.log(`   📊 Total connected users: ${this.connectedUsers.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('   ❌ Socket Auth Failed:', message);
      client.disconnect(true);
    }
  }

  /**
   * Handle diskoneksi
   */
  handleDisconnect(client: SocketWithAuth) {
    if (client.data.user) {
      const userId = client.data.user.id;
      this.connectedUsers.delete(userId);

      // [BARU] Broadcast status offline
      this.server.emit('userStatus', { userId, isOnline: false });

      console.log(`Client disconnected: ${userId}`);
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() data: { conversationId: string; isTyping: boolean },
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    if (!client.data?.user) return;

    const senderId = client.data.user.id;

    // Cari partisipan lain di conversation ini untuk dikirimi notif typing
    // (Bisa query DB atau kirim client yang mengirim list recipientId agar lebih cepat)
    const recipientIds = await this.chatService.getRecipientIds(
      data.conversationId,
      senderId,
    );

    // Broadcast ke recipient
    for (const id of recipientIds) {
      const socket = this.connectedUsers.get(id);
      if (socket) {
        socket.emit('partnerTyping', {
          conversationId: data.conversationId,
          userId: senderId,
          isTyping: data.isTyping,
        });
      }
    }
  }

  /**
   * [BARU] Helper untuk client cek status online user tertentu saat load awal
   */
  @SubscribeMessage('checkUserStatus')
  handleCheckUserStatus(
    @MessageBody() userId: string,
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    const isOnline = this.connectedUsers.has(userId);
    client.emit('userStatus', { userId, isOnline });
  }

  /**
   * [Event] User meminta riwayat pesan
   */

  @SubscribeMessage('getHistory')
  async handleGetHistory(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    // [FIX] Cek apakah user sudah terautentikasi sebelum akses properti
    if (!client.data?.user) return;

    const userId = client.data.user.id;
    const history = await this.chatService.getMessageHistory(
      userId,
      conversationId,
    );
    client.emit('messageHistory', history);
  }

  /**
   * [Event] User mengirim pesan
   */

  /**
   * [PUBLIC] Broadcast pesan ke user tertentu (Dipanggil oleh Service/Controller)
   */
  broadcastMessage(userId: string, message: any) {
    console.log(`🔔 [Gateway] broadcastMessage called for userId: ${userId}`);
    console.log(`   Message ID: ${message.id}`);
    console.log(`   Connected users count: ${this.connectedUsers.size}`);
    console.log(`   Connected users: ${Array.from(this.connectedUsers.keys()).join(', ')}`);

    const socket = this.connectedUsers.get(userId);
    if (socket) {
      console.log(`   ✅ Socket found for user ${userId}, emitting 'newMessage'`);
      socket.emit('newMessage', message);
      return true; // Online
    }
    console.log(`   ❌ Socket NOT found for user ${userId} - user appears offline`);
    return false; // Offline
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    if (!client.data?.user) return;

    const sender = client.data.user;

    console.log(`📨 [WebSocket] sendMessage from ${sender.fullName} (${sender.id})`);
    console.log(`   Conversation: ${dto.conversationId}`);
    console.log(`   Content: ${dto.content.substring(0, 50)}...`);

    // 1. Simpan pesan ke DB
    const message = await this.chatService.saveMessage(sender.id, dto);

    console.log(`   ✅ Message saved with ID: ${message.id}`);

    // 2. Broadcast ke penerima (jika online)
    const recipientIds = await this.chatService.getRecipientIds(
      dto.conversationId,
      sender.id,
    );

    console.log(`   Recipients: ${recipientIds.join(', ')}`);
    console.log(`   Connected users: ${Array.from(this.connectedUsers.keys()).join(', ')}`);

    for (const id of recipientIds) {
      const recipientSocket = this.connectedUsers.get(id);
      if (recipientSocket) {
        // Online: Kirim via WebSocket
        console.log(`   ✅ Broadcasting to online user: ${id}`);
        recipientSocket.emit('newMessage', message);
      } else {
        // Offline: Kirim via Notifikasi (Menyelesaikan TODO)
        console.log(`   ⚠️ User ${id} offline, sending notification`);
        await this.notificationService.create({
          userId: id,
          content: `Pesan baru dari ${sender.fullName}: "${message.content.substring(0, 30)}..."`,
          link: `/chat/${dto.conversationId}`,
          type: 'CHAT',
        });
      }
    }

    // 3. Kirim kembali ke pengirim (untuk konfirmasi)
    console.log(`   ↩️ Sending confirmation to sender: ${sender.id}`);
    client.emit('newMessage', message);
  }
}
