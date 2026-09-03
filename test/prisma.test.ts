import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The Prisma client is constructed lazily behind a proxy, and that is not a
 * micro-optimisation — `next build` walks the module graph while collecting page
 * data, so an eagerly constructed client turns DATABASE_URL into a *build*-time
 * requirement and fails the build on a machine that only has an .env.example.
 * That is precisely the bug these two tests pin down.
 */

const saved = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("lib/prisma", () => {
  it("imports with no DATABASE_URL set", async () => {
    const mod = await import("@/lib/prisma");
    expect(mod.prisma).toBeDefined();
  });

  it("fails at first use, with a message that says how to fix it", async () => {
    const { prisma } = await import("@/lib/prisma");
    // Touching any property is what triggers construction.
    expect(() => prisma.$connect()).toThrow(/DATABASE_URL is not set/);
    expect(() => prisma.$connect()).toThrow(/\.env\.local/);
  });

  /**
   * Each of these was hit for real while wiring the app up to Supabase, and each
   * one surfaced somewhere unhelpful — an opaque ERR_INVALID_URL inside a Prisma
   * stack, or a P1003 several layers down claiming the database did not exist.
   * The point of the checks is that the message names the actual mistake.
   */
  it("names a missing database name instead of failing later with P1003", async () => {
    // No /postgres path: node-postgres then uses the *username* as the database.
    process.env.DATABASE_URL =
      "postgresql://postgres.abcdef:pw@aws-0-ap-south-1.pooler.supabase.com:6543";
    const { prisma } = await import("@/lib/prisma");
    expect(() => prisma.$connect()).toThrow(/no database name/);
  });

  it("names Supabase's bracketed password placeholder", async () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:[YOUR-PASSWORD]@db.abcdef.supabase.co:5432/postgres";
    const { prisma } = await import("@/lib/prisma");
    expect(() => prisma.$connect()).toThrow(/square brackets/);
  });

  it("names a string that is not a URI at all", async () => {
    process.env.DATABASE_URL = "db.abcdef.supabase.co:5432";
    const { prisma } = await import("@/lib/prisma");
    expect(() => prisma.$connect()).toThrow(/does not start with postgresql:\/\//);
  });
});
