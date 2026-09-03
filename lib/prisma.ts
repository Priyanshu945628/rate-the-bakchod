import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 talks to Postgres through a driver adapter rather than a bundled
 * Rust engine, so the connection string is supplied here rather than in
 * schema.prisma. This is the *pooled* URL (Supabase port 6543); migrations use
 * the direct URL from prisma.config.ts instead.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste your " +
        "Supabase connection strings into it.",
    );
  }

  // Without these checks a bad string surfaces as a bare `ERR_INVALID_URL` from
  // inside a Prisma stack trace, which says nothing about what to fix. Nothing
  // here ever echoes the string itself — it contains the password.
  if (/[<>]/.test(connectionString)) {
    throw new Error(
      "DATABASE_URL still contains the .env.example placeholders (<project-ref>, " +
        "<password>, <region>). Replace them with the real connection string from " +
        "Supabase → Project Settings → Database → Connection string → URI.",
    );
  }

  // Supabase's dashboard renders the password as [YOUR-PASSWORD], brackets and
  // all, and square brackets are not legal there — they are URL syntax for IPv6
  // hosts. This is the single most common paste mistake.
  if (/[[\]]/.test(connectionString)) {
    throw new Error(
      "DATABASE_URL contains square brackets. Supabase shows the password as " +
        "[YOUR-PASSWORD] in the dashboard — replace that whole bracketed " +
        "placeholder, brackets included, with your actual database password. " +
        "If you have forgotten it, reset it under Project Settings → Database.",
    );
  }

  if (/\s/.test(connectionString)) {
    throw new Error(
      "DATABASE_URL contains a space or a line break. A connection string copied " +
        "across two lines will not parse — put it on one line, in quotes.",
    );
  }

  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      "DATABASE_URL does not start with postgresql://. Copy the whole URI from " +
        "Supabase → Connect → Transaction pooler — not just the host, and not the " +
        "`psql ...` command wrapped around it.",
    );
  }

  try {
    const parsed = new URL(connectionString);
    if (!parsed.protocol.startsWith("postgres")) {
      throw new Error(
        `DATABASE_URL should be a postgresql:// URL, but its scheme is "${parsed.protocol}".`,
      );
    }
    // node-postgres falls back to the *username* as the database name when the
    // URL has no path, so a missing `/postgres` surfaces much later as
    // P1003 `Database "postgres.<ref>" does not exist` on the first query.
    if (parsed.pathname === "" || parsed.pathname === "/") {
      throw new Error(
        "DATABASE_URL has no database name. It must end with /postgres before " +
          "the query string, e.g. ...pooler.supabase.com:6543/postgres?pgbouncer=true. " +
          "Without it every query fails with P1003.",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("DATABASE_URL")) throw err;
    throw new Error(
      "DATABASE_URL is not a parseable URL. The usual cause is a password " +
        "containing characters that must be percent-encoded — @ becomes %40, " +
        "# becomes %23, / becomes %2F, ? becomes %3F, : becomes %3A. Reset the " +
        "database password in Supabase if it is easier than escaping it.",
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    // v7 adapters inherit node-postgres defaults, where connectionTimeoutMillis
    // is 0 — a stalled connect would hang a request forever. Bound it.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js hot-reloads modules in dev, which would otherwise open a new pool on
// every edit and exhaust Supabase's connection limit.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function client(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const created = createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = created;
  return created;
}

/**
 * Lazily constructed, via a proxy that builds the real client on first use.
 *
 * `next build` walks the module graph while collecting page data, so a client
 * created at import time would make `DATABASE_URL` a *build*-time requirement —
 * and a build should not need production database credentials to run. Deferring
 * to first property access keeps the failure where it belongs: at the first
 * query, in a request, with the message above.
 *
 * In production the instance is cached in a closure on first touch, so this
 * costs one extra property lookup per call and nothing else.
 */
let cached: PrismaClient | undefined;

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    cached ??= client();
    // The receiver is deliberately the real client, not the proxy: Prisma's
    // internals reach for private class fields, and those throw outright when
    // `this` is a proxy rather than the instance they were declared on.
    const value = Reflect.get(cached, prop, cached);
    // Model delegates and methods must stay bound to the real client too.
    return typeof value === "function" ? value.bind(cached) : value;
  },
  has(_target, prop) {
    cached ??= client();
    return Reflect.has(cached, prop);
  },
});
