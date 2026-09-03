import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not read Next.js env files on its own.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/**
 * Prisma 7 moved connection URLs out of schema.prisma.
 *
 * `datasource.url` here is used only by the CLI — migrate, db push, studio — so
 * it points at Supabase's DIRECT connection (port 5432). Migrations cannot run
 * through the transaction pooler, which does not support prepared statements or
 * the advisory locks Migrate relies on.
 *
 * The application's own connection string (the pooler, port 6543) is passed to
 * the driver adapter in lib/prisma.ts instead. `directUrl` no longer exists in
 * v7; the split now lives across these two places.
 *
 * Read through process.env rather than prisma/config's env() helper, which
 * throws when a variable is missing — `prisma generate` must keep working with
 * no database configured at all.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
