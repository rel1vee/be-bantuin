import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ConfigModule } from '@nestjs/config';
import { OrdersModule } from '../orders/orders.module';

@Module({
  // Gunakan forwardRef untuk menghindari circular dependency dengan OrdersModule
  imports: [ConfigModule, forwardRef(() => OrdersModule)], // Import OrdersModule agar OrdersService tersedia di konteks PaymentsModule
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService], // Export agar bisa dipakai OrdersModule
})
export class PaymentsModule {}
