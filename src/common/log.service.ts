// src/common/log.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import pino from 'pino';

const logger = pino({
  level: 'warn',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

@Injectable()
export class LogService {
  constructor(private prisma: PrismaService) {}

  async securityLog(data: {
    level: 'warn' | 'error';
    ip: string;
    method: string;
    url: string;
    userAgent?: string;
    payload?: any;
    message: string;
    userId?: string;
  }) {
    await this.prisma.securityLog.create({ data });

    logger.warn({
      ip: data.ip,
      method: data.method,
      url: data.url,
      message: data.message,
      userId: data.userId,
    });
  }

  async userActivityLog(data: {
    userId: string;
    action: string;
    ip?: string;
    device?: string;
    status?: string;
    details?: string;
  }) {
    await this.prisma.userActivityLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        ip: data.ip,
        device: data.device,
        status: data.status || 'success',
        details: data.details,
      },
    });
  }
}
