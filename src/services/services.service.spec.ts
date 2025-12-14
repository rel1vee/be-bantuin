import { Test, TestingModule } from '@nestjs/testing';
import { ServicesService } from './services.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let module: TestingModule;

  const mockPrismaService = {};
  const mockNotifications = {};

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: 'NotificationsService', useValue: mockNotifications },
        {
          provide: (require('../notifications/notifications.service') as any)
            .NotificationsService,
          useValue: mockNotifications,
        },
      ],
    }).compile();

    service = module.get<ServicesService>(ServicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns NotFound for PENDING service to anonymous users', async () => {
    const prisma = module.get(PrismaService) as any;
    prisma.service = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        status: 'PENDING' as any,
        isActive: false,
        sellerId: 's1',
      }),
    };

    await expect(service.findOne('p1')).rejects.toThrow('Jasa tidak ditemukan');
  });

  it('allows owner to view their PENDING service', async () => {
    const prisma = module.get(PrismaService) as any;
    prisma.service = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p2',
        status: 'PENDING' as any,
        isActive: false,
        sellerId: 'owner-1',
      }),
    };

    const res = await service.findOne('p2', 'owner-1');
    expect(res).toBeDefined();
  });

  it('allows admin to view PENDING service', async () => {
    const prisma = module.get(PrismaService) as any;
    prisma.service = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p3',
        status: 'PENDING' as any,
        isActive: false,
        sellerId: 'owner-1',
      }),
    };

    const res = await service.findOne('p3', undefined, 'ADMIN');
    expect(res).toBeDefined();
  });
});
