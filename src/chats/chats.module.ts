import { Module } from '@nestjs/common';
import { ChatsGateway } from './chats.gateway';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule], // Impor AuthModule untuk akses AuthService
  providers: [ChatsGateway, ChatsService],
  controllers: [ChatsController],
})
export class ChatsModule { }
