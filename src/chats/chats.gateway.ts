import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
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

// Helper function untuk normalize dan mendapatkan allowed origins
function getAllowedWsOrigins(): string[] | false {
  const normalizeUrl = (url: string | undefined): string | null => {
    if (!url) return null;
    return url.trim().replace(/\/+$/, ''); // Remove trailing slash(es)
  };

  const origins = [normalizeUrl(process.env.FRONTEND_URL)].filter(
    (origin): origin is string => Boolean(origin),
  );

  if (origins.length === 0) {
    console.warn('⚠️  WebSocket CORS: No FRONTEND_URL set');
    return false;
  }

  console.log('✅ WebSocket CORS enabled for origins:', origins);
  return origins;
}

const allowedWsOrigins = getAllowedWsOrigins();

@WebSocketGateway({
  cors: {
    origin: allowedWsOrigins || false, // Hanya dari FRONTEND_URL (normalized)
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
})
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private connectedUsers: Map<string, Socket> = new Map();

  constructor(
    private chatService: ChatsService,
    private authService: AuthService,
    private notificationService: NotificationsService,
  ) { }

  /**
   * Handle koneksi baru
   */
  async handleConnection(client: SocketWithAuth) {
    try {
      // 1. Autentikasi user dari token
      const token = client.handshake.auth.token as string;
      if (!token) throw new Error('No token provided');

      // 2. Gunakan AuthService untuk validasi JWT
      // Ini jauh lebih clean dan terenkapsulasi
      const user = await this.authService.validateUserFromJwt(token);
      if (!user) throw new Error('Invalid user');

      // 3. Simpan data user di socket
      client.data.user = user;
      this.connectedUsers.set(user.id, client);
      void client.join(user.id);

      console.log(`Client connected: ${user.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Socket Auth Failed:', message);
      client.disconnect(true);
    }
  }

  /**
   * Handle diskoneksi
   */
  handleDisconnect(client: SocketWithAuth) {
    if (client.data.user) {
      this.connectedUsers.delete(client.data.user.id);
      console.log(`Client disconnected: ${client.data.user.id}`);
    }
  }

  /**
   * [Event] User mengirim pesan
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    const sender = client.data.user;

    // 1. Simpan pesan ke DB
    const message = await this.chatService.saveMessage(sender.id, dto);

    // 2. Broadcast ke penerima (jika online)
    const recipientIds = await this.chatService.getRecipientIds(
      dto.conversationId,
      sender.id,
    );

    for (const id of recipientIds) {
      const recipientSocket = this.connectedUsers.get(id);
      if (recipientSocket) {
        // Online: Kirim via WebSocket
        recipientSocket.emit('newMessage', message);
      } else {
        // Offline: Kirim via Notifikasi (Menyelesaikan TODO)
        await this.notificationService.create({
          userId: id,
          content: `Pesan baru dari ${sender.fullName}: "${message.content.substring(0, 30)}..."`,
          link: `/chat/${dto.conversationId}`,
          type: 'CHAT',
        });
      }
    }

    // 3. Kirim kembali ke pengirim (untuk konfirmasi)
    client.emit('newMessage', message);
  }

  /**
   * [Event] User meminta riwayat pesan
   */
  @SubscribeMessage('getHistory')
  async handleGetHistory(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    const userId = client.data.user.id;
    const history = await this.chatService.getMessageHistory(
      userId,
      conversationId,
    );
    client.emit('messageHistory', history); // Kirim balik ke peminta
  }
}
