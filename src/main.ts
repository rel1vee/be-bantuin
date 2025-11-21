import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS - hanya dari FRONTEND_URL
  // Normalize URLs: remove trailing slash dan filter null/undefined
  const normalizeUrl = (url: string | undefined): string | null => {
    if (!url) return null;
    return url.trim().replace(/\/+$/, ''); // Remove trailing slash(es)
  };

  const allowedOrigins = [
    normalizeUrl(configService.get<string>('FRONTEND_URL')),
  ].filter((origin): origin is string => Boolean(origin));

  if (allowedOrigins.length === 0) {
    console.warn(
      '⚠️  WARNING: No FRONTEND_URL set. CORS may not work correctly.',
    );
  } else {
    console.log('✅ CORS enabled for origins:', allowedOrigins);
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Normalize incoming origin (remove trailing slash)
      const normalizedOrigin = origin.replace(/\/+$/, '');

      // Check if origin is in allowed list (with or without trailing slash)
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // Log blocked origin for debugging
      console.warn(`🚫 CORS blocked origin: ${origin}`);
      console.warn(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Authorization'],
    maxAge: 86400, // 24 hours
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Terapkan Validasi Zod secara Global
  app.useGlobalPipes(new ZodValidationPipe());

  const port = configService.get<number>('PORT')!;
  await app.listen(port);
  console.log(`Server is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Unhandled error during bootstrap:', err);
  process.exit(1);
});
