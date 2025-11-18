import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS - hanya dari FRONTEND_URL
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  if (!frontendUrl) {
    throw new Error('FRONTEND_URL is not defined in environment variables');
  }
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
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
