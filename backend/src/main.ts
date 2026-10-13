import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const config = loadEnv();
  const { initObservability } = await import('./common/observability');
  await initObservability();
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./app.setup');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  configureApp(app);

  if (config.SWAGGER_ENABLED) {
    const doc = new DocumentBuilder()
      .setTitle('Alejandro AI API')
      .setDescription('AI Clinic Operations & Reception Assistant — REST API. All responses use the { success, data | error } envelope.')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs-json' });
  }

  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`Alejandro AI API listening on :${config.PORT} (docs: /api/docs)`, 'Bootstrap');
}

void bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
