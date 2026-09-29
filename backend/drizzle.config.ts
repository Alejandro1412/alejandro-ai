import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alejandro' },
  strict: true,
  verbose: true,
});
