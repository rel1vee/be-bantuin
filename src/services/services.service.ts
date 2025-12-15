import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateServiceDto,
  UpdateServiceDto,
  ServiceFilterType,
} from './dto/service.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ServicesService {
  /**
   * Create a new service listing
   * Only sellers can create services
   */
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationsService,
  ) {}

  async create(sellerId: string, dto: CreateServiceDto) {
    // Verify that user is a seller
    const user = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { isSeller: true, isVerified: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    if (!user.isSeller) {
      throw new ForbiddenException(
        'Anda harus menjadi penyedia jasa terlebih dahulu',
      );
    }

    if (!user.isVerified) {
      throw new BadRequestException('Akun Anda belum diverifikasi');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Akun Anda tidak aktif');
    }

    // Create the service in PENDING state waiting for admin approval
    let service;
    try {
      service = await this.prisma.service.create({
        data: {
          sellerId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          price: dto.price,
          deliveryTime: dto.deliveryTime,
          revisions: dto.revisions,
          images: dto.images || [],
          // New services must be reviewed by admin before being active
          status: 'PENDING' as any,
          isActive: false,
        },
        include: {
          seller: {
            select: {
              id: true,
              fullName: true,
              profilePicture: true,
              major: true,
              batch: true,
              avgRating: true,
              totalReviews: true,
              totalOrdersCompleted: true,
            },
          },
        },
      });
    } catch (e: any) {
      // Helpful error messages for common migration/client mismatch issues
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2022'
      ) {
        throw new InternalServerErrorException(
          'Database schema mismatch: missing column on Service (admin_notes). Run `npx prisma migrate dev --name add-service-pending` and then `npx prisma generate`, then restart the server.',
        );
      }
      if (
        e instanceof Prisma.PrismaClientUnknownRequestError &&
        typeof e.message === 'string' &&
        e.message.includes('invalid input value for enum')
      ) {
        throw new InternalServerErrorException(
          'Database enum mismatch: ServiceStatus is missing values (PENDING/REJECTED). Run `npx prisma migrate dev --name add-service-pending` and `npx prisma generate`.',
        );
      }
      throw e;
    }

    // Notify seller that their service is pending review
    void this.notificationService.create({
      userId: sellerId,
      content: `Jasa "${service.title}" telah dibuat dan menunggu persetujuan administrator.`,
      link: `/services/${service.id}`,
      type: 'GENERAL',
    });

    // Notify all admins that there's a new service pending review
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    for (const admin of admins) {
      void this.notificationService.createInTx(this.prisma as any, {
        userId: admin.id,
        content: `Jasa baru "${service.title}" menunggu review administrator.`,
        link: `/admin/services/pending`,
        type: 'GENERAL',
      });
    }

    return service;
  }

  /**
   * Get all services with filtering and pagination
   */
  async findAll(filters: ServiceFilterType) {
    const {
      q,
      category,
      priceMin,
      priceMax,
      ratingMin,
      sellerId,
      page,
      limit,
      sortBy,
    } = filters;

    // Build where clause
    const where: Prisma.ServiceWhereInput = {
      isActive: true,
      status: 'ACTIVE',
    };

    // Search query
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (category) {
      where.category = category;
    }

    // Price range
    if (priceMin !== undefined || priceMax !== undefined) {
      where.price = {};
      if (priceMin !== undefined) {
        where.price.gte = priceMin;
      }
      if (priceMax !== undefined) {
        where.price.lte = priceMax;
      }
    }

    // Rating filter
    if (ratingMin !== undefined) {
      where.avgRating = { gte: ratingMin };
    }

    // Seller filter
    if (sellerId) {
      where.sellerId = sellerId;
    }

    // Build orderBy clause
    let orderBy: Prisma.ServiceOrderByWithRelationInput = {};
    switch (sortBy) {
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'price_low':
        orderBy = { price: 'asc' };
        break;
      case 'price_high':
        orderBy = { price: 'desc' };
        break;
      case 'rating':
        orderBy = { avgRating: 'desc' };
        break;
      case 'popular':
        orderBy = { totalOrders: 'desc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Execute queries
    const [services, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        orderBy,
        skip,
        take: Number(limit),
        include: {
          seller: {
            select: {
              id: true,
              fullName: true,
              profilePicture: true,
              major: true,
              batch: true,
              avgRating: true,
              totalReviews: true,
              totalOrdersCompleted: true,
            },
          },
        },
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      data: services,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single service by ID
   */
  /**
   * Get a single service by ID
   * If the service is not ACTIVE (e.g., PENDING/REJECTED) it will only be visible
   * to the seller who owns it or to admins. Public access will return NotFound.
   */
  async findOne(id: string, viewerId?: string, viewerRole?: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            bio: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
            totalOrdersCompleted: true,
            createdAt: true,
          },
        },
        reviews: {
          where: {
            order: {
              status: 'COMPLETED',
            },
          },
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            author: {
              select: {
                id: true,
                fullName: true,
                profilePicture: true,
                major: true,
              },
            },
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    // If service isn't active, restrict visibility
    if (service.status !== ('ACTIVE' as any) || !service.isActive) {
      const isOwner = viewerId && viewerId === service.sellerId;
      const isAdmin = viewerRole === 'ADMIN';
      if (!isOwner && !isAdmin) {
        throw new NotFoundException('Jasa tidak ditemukan');
      }
    }

    return service;
  }

  /**
   * Update a service
   * Only the owner can update
   */
  async update(id: string, sellerId: string, dto: UpdateServiceDto) {
    // Check if service exists and belongs to seller
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Update service
    const updated = await this.prisma.service.update({
      where: { id },
      data: dto,
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Toggle service active status
   */
  async toggleActive(id: string, sellerId: string) {
    // Check ownership
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true, isActive: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Toggle active status
    const updated = await this.prisma.service.update({
      where: { id },
      data: { isActive: !service.isActive },
    });

    return updated;
  }

  /**
   * Delete a service (soft delete by setting status to 'deleted')
   */
  async remove(id: string, sellerId: string) {
    // Check ownership
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: { sellerId: true },
    });

    if (!service) {
      throw new NotFoundException('Jasa tidak ditemukan');
    }

    if (service.sellerId !== sellerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke jasa ini');
    }

    // Check if there are active orders
    const activeOrders = await this.prisma.order.count({
      where: {
        serviceId: id,
        status: {
          in: ['DRAFT', 'IN_PROGRESS', 'DELIVERED'],
        },
      },
    });

    if (activeOrders > 0) {
      throw new BadRequestException(
        'Tidak dapat menghapus jasa dengan pesanan yang masih aktif',
      );
    }

    // Soft delete
    await this.prisma.service.update({
      where: { id },
      data: {
        status: 'DELETED',
        isActive: false,
      },
    });

    return { message: 'Jasa berhasil dihapus' };
  }

  /**
   * Get seller's services
   */
  async getSellerServices(sellerId: string) {
    try {
      const services = await this.prisma.service.findMany({
        where: {
          sellerId,
          status: { not: 'DELETED' } as any,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      return services;
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2022'
      ) {
        throw new InternalServerErrorException(
          'Database schema mismatch: missing column on Service (admin_notes). Run `npx prisma migrate dev --name add-service-pending` and `npx prisma generate`.',
        );
      }
      throw e;
    }
  }

  async getFeatured() {
    return this.prisma.service.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
        avgRating: { gte: 4.0 }, // Minimal rating 4.0
      },
      orderBy: [
        { avgRating: 'desc' }, // Rating tertinggi dulu
        { totalOrders: 'desc' }, // Lalu jumlah order terbanyak
      ],
      take: 4, // Ambil 4 teratas
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            profilePicture: true,
            major: true,
            batch: true,
            avgRating: true,
            totalReviews: true,
            totalOrdersCompleted: true,
          },
        },
      },
    });
  }
}
