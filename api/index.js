const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');

let app;

async function bootstrap() {
  if (!app) {
    app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api');
    app.enableCors({
      origin: true,
      credentials: true,
    });
    await app.init();
  }
  return app;
}

module.exports = async (req, res) => {
  const server = await bootstrap();
  const instance = server.getHttpAdapter().getInstance();
  return instance(req, res);
};
