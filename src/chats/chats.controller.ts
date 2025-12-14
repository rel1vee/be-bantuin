import { Controller, Get, Post, Body, UseGuards, Param } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { CreateConversationDto } from './dto/chat.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chatService: ChatsService) { }

  /**
   * [REST] Memulai obrolan baru (atau mengirim pesan ke yang sudah ada)
   * POST /api/chat
   */
  @Post()
  async createConversation(
    @GetUser('id') senderId: string,
    @Body() dto: CreateConversationDto,
  ) {
    const result = await this.chatService.findOrCreateConversation(
      senderId,
      dto,
    );
    return {
      success: true,
      message: result.isNew
        ? 'Obrolan baru dibuat'
        : 'Pesan terkirim ke obrolan',
      data: result.conversation,
    };
  }

  /**
   * [REST] Mendapatkan semua obrolan (Inbox)
   * GET /api/chat
   */
  @Get()
  async getMyConversations(@GetUser('id') userId: string) {
    const conversations = await this.chatService.getMyConversations(userId);
    return {
      success: true,
      data: conversations,
    };
  }

  /**
   * [REST] Tandai obrolan sebagai sudah dibaca
   * POST /api/chat/:id/read
   */
  @Post(':id/read')
  async markAsRead(
    @GetUser('id') userId: string,
    @Param('id') conversationId: string,
  ) {
    await this.chatService.markConversationAsRead(userId, conversationId);
    return { success: true };
  }
}
