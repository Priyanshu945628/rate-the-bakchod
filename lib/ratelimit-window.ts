/**
 * The pure half of rate limiting: which fixed window a moment belongs to, and
 * what verdict a given count in that window earns.
 *
 * Split out from `lib/ratelimit.ts` deliberately — that module reaches for
 * Prisma, and this arithmetic is the part worth having tests for.
 */

import { rateLimits, type RateLimitBucket } from "./config";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Start of the current fixed window, so all requests in it share one row. */
export function windowStartFor(windowSec: number, now: Date): Date {
  const ms = windowSec * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Verdict for a bucket, given the count already recorded in this window.
 * `count` is the value *after* this request was counted, so the first request in
 * a window arrives here as 1.
 */
export function evaluateRateLimit(
  count: number,
  bucket: RateLimitBucket,
  windowStart: Date,
  now: Date,
): RateLimitResult {
  const { max, windowSec } = rateLimits[bucket];
  const resetAt = windowStart.getTime() + windowSec * 1000;
  return {
    ok: count <= max,
    remaining: Math.max(0, max - count),
    // Never advertise 0 — a client that retries "in zero seconds" is a hot loop.
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}
