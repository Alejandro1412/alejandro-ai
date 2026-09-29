/* Runs once before the e2e suite: creates the test database if needed, applies migrations and loads the demo seed. */
import './setup-env';
import { Client } from 'pg';
import { runMigrations } from '../src/database/migrate';
import { runSeed } from '../src/database/seed/seed';

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unsafe test database name: ${name}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL!;
  await ensureDatabase(url);
  await runMigrations(url);
  await runSeed(url, { quiet: true });
}
