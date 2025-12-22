import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import morgan from 'morgan';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const pinoLogger = pino({
    level: 'info',
    // Hapus pino-pretty di production
    ...(!isProduction && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH: MM:ss',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      },
    }),
  });

  // Buat app
  const app = await NestFactory.create(AppModule, {
    logger: isProduction
      ? ['error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Morgan: log request standar
  app.use(morgan('combined'));

  // PinoHttp: log request/response detail
  app.use(pinoHttp({ logger: pinoLogger }));

  // Sentry: notifikasi error
  Sentry.init({
    dsn: 'https://example@sentry.io/1234567', // dns asli nyusul
    tracesSampleRate: 1.0,
  });

  app.use(
    helmet({
      frameguard: {
        action: 'sameorigin', // atau 'deny'
      },
      xssFilter: true,
      noSniff: true,
      hidePoweredBy: true,
      referrerPolicy: {
        policy: 'no-referrer',
      },
      hsts: {
        maxAge: 31536000, // 1 tahun
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'self'"],
        },
      },
    }),
  );

  // Enable CORS Dinamis (FIXED TYPE SAFE)
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const frontendUrl = configService.get<string>('FRONTEND_URL');

      // Izinkan request tanpa origin (Postman, curl, dll.)
      if (!origin) {
        return callback(null, true);
      }

      // Validasi origin dengan type safe
      if (
        origin === frontendUrl ||
        origin.startsWith('http://localhost') ||
        origin.includes('.ngrok-free.dev') ||
        origin.includes('.ngrok.io') ||
        origin.includes('.vercel.app') ||
        origin.includes('https://api.bantuin-campus.me')
      ) {
        callback(null, true);
      } else {
        console.warn(`CORS Blocked for origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Validasi Zod Global
  app.useGlobalPipes(new ZodValidationPipe());

  const port = configService.get<number>('PORT') || 5500;
  await app.listen(port);
  console.log(`Server is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Unhandled error during bootstrap:', err);
  process.exit(1);
});
