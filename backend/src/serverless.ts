/**
 * Serverless entry (Vercel Functions). The same Nest application as main.ts, created once per warm
 * instance. On first boot it applies pending migrations and, if the database is empty, loads the
 * NovaCare demo data — guarded by a Postgres advisory lock so concurrent cold starts don't race.
 *
 * Limits of this mode (documented in docs/deployment.md): no WebSockets (the UI falls back to
 * polling/refetch), background jobs run inline, and periodic sweeps need an external trigger.
 */
import 'reflect-metadata';
// Static imports so the bundler/tracer includes packages Nest otherwise loads dynamically.
import '@nestjs/platform-express';
import '@nestjs/platform-socket.io';
import type { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { Pool } from 'pg';
import { env, loadEnv } from './config/env';

let ready: Promise<Express> | null = null;

const BOOTSTRAP_LOCK = 724_100_001;

async function bootstrapDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [BOOTSTRAP_LOCK]);
    const { runMigrations } = await import('./database/migrate');
    await runMigrations(url);
    if (process.env.SEED_DEMO_DATA !== 'false') {
      process.env.SEED_FORCE = 'true';
      const { runSeed } = await import('./database/seed/seed');
      await runSeed(url, { ifEmpty: true, quiet: true });
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [BOOTSTRAP_LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function create(): Promise<Express> {
  loadEnv();
  // Migrations need a direct (non-pooled) connection: PgBouncer transaction pooling breaks advisory locks.
  const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || env().DATABASE_URL;
  if (process.env.AUTO_BOOTSTRAP !== 'false') await bootstrapDatabase(direct);
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./app.setup');
  const server = express();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(server), { rawBody: true, logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  return server;
}

/** Vercel Node.js function handler. */
export default async function handler(req: Parameters<Express>[0], res: Parameters<Express>[1]): Promise<void> {
  ready ??= create().catch((err) => {
    ready = null; // let the next request retry a failed cold start
    throw err;
  });
  try {
    const app = await ready;
    app(req, res);
  } catch (err) {
    console.error('Cold start failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: { code: 'SERVICE_STARTING', message: 'The API is starting or misconfigured. Try again in a moment.' } }));
  }
}
