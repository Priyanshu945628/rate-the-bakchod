import "server-only";

/**
 * Fixed-window rate limiting, backed by Postgres rather than process memory so
 * the limits survive restarts and hold across multiple server instances.
 *
 * The increment is a single atomic upsert, so concurrent requests from the same
 * user cannot both read a stale count and slip through together. The window
 * arithmetic lives in `./ratelimit-window`, which is DB-free and tested.
 */

import { prisma } from "./prisma";
import { rateLimits, type RateLimitBucket } from "./config";
import {
  evaluateRateLimit,
  windowStartFor,
  type RateLimitResult,
} from "./ratelimit-window";

export type { RateLimitResult };

export async function consumeRateLimit(
  userId: string,
  bucket: RateLimitBucket,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const { windowSec } = rateLimits[bucket];
  const windowStart = windowStartFor(windowSec, now);

  const row = await prisma.rateLimit.upsert({
    where: {
      userId_bucket_windowStart: { userId, bucket, windowStart },
    },
    create: { userId, bucket, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  return evaluateRateLimit(row.count, bucket, windowStart, now);
}

/** Housekeeping: drop windows that can no longer be current. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const longest = Math.max(...Object.values(rateLimits).map((r) => r.windowSec));
  const cutoff = new Date(now.getTime() - longest * 2000);
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return count;
}
