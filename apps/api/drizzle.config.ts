import { defineConfig } from 'drizzle-kit'

// Used only by `pnpm db:generate` (dev time). Runtime migrations use drizzle-orm's migrator (ADR 0002).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
