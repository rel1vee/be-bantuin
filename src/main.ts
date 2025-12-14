import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import morgan from 'morgan';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/nestjs';

async function bootstrap() {
  const pinoLogger = pino({
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  });

  // Buat app
  const app = await NestFactory.create(AppModule);

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
        origin.includes('.ngrok.io')
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
