/* Boots the real Nest application (same hardening as production) against the seeded test database. */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

export const PASSWORD = 'NovaCare2026!';
export const ACCOUNTS = {
  admin: 'admin@novacare.co',
  reception: 'recepcion@novacare.co',
  doctor: 'carlos.perez@novacare.co',
  patient: 'maria.rodriguez@example.com',
  auroraAdmin: 'admin@aurora.mx',
  owner: 'owner@alejandro.ai',
} as const;

export interface Harness {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  login: (email: string, password?: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  const server = app.getHttpServer();
  const tokens = new Map<string, string>();
  return {
    app,
    http: () => request(server),
    async login(email, password = PASSWORD) {
      const cached = tokens.get(email);
      if (cached) return cached;
      const res = await request(server).post('/api/auth/login').send({ email, password });
      if (res.status !== 200 && res.status !== 201) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      tokens.set(email, res.body.data.accessToken);
      return res.body.data.accessToken as string;
    },
    close: () => app.close(),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
