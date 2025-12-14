import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LogService } from './log.service';
import { SUSPICIOUS_PATTERNS } from '../config/security-patterns';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  constructor(private logService: LogService) {}

  // Counter untuk rate limit & brute force
  private requestCount = new Map<
    string,
    {
      count: number;
      resetTime: number;
      loginAttempts?: number;
      loginResetTime?: number;
    }
  >();

  private blockedIPs = new Map<string, number>();

  async use(req: Request<any, any, any>, res: Response, next: NextFunction) {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const url = req.originalUrl.toLowerCase();

    // === 1. Cek kalau IP sedang diblokir ===
    if (this.blockedIPs.has(ip) && now < this.blockedIPs.get(ip)!) {
      await this.logService.securityLog({
        level: 'error',
        ip,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('user-agent') ?? undefined,
        payload: req.body as unknown,
        message: 'Request blocked: IP temporarily banned due to brute force or high rate',
        userId: undefined,
      });

      return res.status(403).json({
        message: 'Access denied: Too many requests. Try again later.',
      });
    }

    // === 2. General Rate Limit (100 request dalam 60 detik) ===
    if (!this.requestCount.has(ip)) {
      this.requestCount.set(ip, { count: 1, resetTime: now + 60_000 });
    } else {
      const data = this.requestCount.get(ip)!;
      if (now > data.resetTime) {
        data.count = 1;
        data.resetTime = now + 60_000;
      } else {
        data.count++;
      }

      if (data.count > 100) {
        const blockUntil = now + 600_000;
        this.blockedIPs.set(ip, blockUntil);

        await this.logService.securityLog({
          level: 'error',
          ip,
          method: req.method,
          url: req.originalUrl,
          userAgent: req.get('user-agent') ?? undefined,
          payload: req.body as unknown,
          message: `IP blocked for 10 minutes due to high request rate: ${data.count} requests in 60s (possible scan/DoS)`,
          userId: undefined,
        });

        return res.status(403).json({
          message: 'Too many requests. Please slow down and try again in 10 minutes.',
        });
      }

      this.requestCount.set(ip, data);
    }

    // === 3. Brute Force Detection khusus login ===
    if (url.includes('/api/auth/login') || url.includes('/login')) {
      const data = this.requestCount.get(ip)!;
      if (!data.loginAttempts) data.loginAttempts = 0;
      if (!data.loginResetTime || now > data.loginResetTime) {
        data.loginAttempts = 1;
        data.loginResetTime = now + 300_000;
      } else {
        data.loginAttempts++;
      }

      if (data.loginAttempts > 10) {
        const blockUntil = now + 600_000;
        this.blockedIPs.set(ip, blockUntil);

        await this.logService.securityLog({
          level: 'error',
          ip,
          method: req.method,
          url: req.originalUrl,
          userAgent: req.get('user-agent') ?? undefined,
          payload: req.body as unknown,
          message: `IP blocked for 10 minutes due to brute force: ${data.loginAttempts} attempts`,
          userId: undefined,
        });

        return res.status(403).json({
          message: 'Too many failed login attempts. Account locked for 10 minutes.',
        });
      }
    }

    // === 4. Keyword-based detection ===
    const bodyStr = JSON.stringify(req.body ?? {}).toLowerCase();
    const isSuspicious = SUSPICIOUS_PATTERNS.some((pattern) => {
      return url.includes(pattern) || bodyStr.includes(pattern);
    });

    if (isSuspicious) {
      await this.logService.securityLog({
        level: 'warn',
        ip,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('user-agent') ?? undefined,
        payload: req.body as unknown,
        message: 'Possible attack detected (keyword match)',
        userId: (req as Request & { user?: { id: string } }).user?.id ?? undefined,
      });
    }

    next();
  }
}
