import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';

describe('AdminService', () => {
  let service: AdminService;

  const mockPrismaService = {};
  const mockWalletsService = {};
  const mockNotificationsService = {};
  const mockOrdersService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WalletsService, useValue: mockWalletsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: OrdersService, useValue: mockOrdersService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose pending service management methods', () => {
    expect(typeof service.getPendingServices).toBe('function');
    expect(typeof service.approveService).toBe('function');
    expect(typeof service.rejectService).toBe('function');
  });
});
