import { describe, expect, it } from "vitest";
import { evaluateRateLimit, windowStartFor } from "@/lib/ratelimit-window";
import { rateLimits } from "@/lib/config";

describe("windowStartFor", () => {
  it("snaps every moment in an hour to the same boundary", () => {
    const a = windowStartFor(3600, new Date("2026-09-02T12:00:00Z"));
    const b = windowStartFor(3600, new Date("2026-09-02T12:59:59.999Z"));
    expect(a.toISOString()).toBe("2026-09-02T12:00:00.000Z");
    expect(b.getTime()).toBe(a.getTime());
  });

  it("moves to a new window the instant the boundary passes", () => {
    const before = windowStartFor(3600, new Date("2026-09-02T12:59:59.999Z"));
    const after = windowStartFor(3600, new Date("2026-09-02T13:00:00.000Z"));
    expect(after.getTime() - before.getTime()).toBe(3_600_000);
  });

  it("handles the daily window used for reports", () => {
    const start = windowStartFor(86_400, new Date("2026-09-02T23:59:00Z"));
    expect(start.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("evaluateRateLimit", () => {
  const now = new Date("2026-09-02T12:30:00Z");
  const windowStart = windowStartFor(3600, now);

  it("allows requests up to and including the cap", () => {
    const { max } = rateLimits.rate;
    expect(evaluateRateLimit(1, "rate", windowStart, now).ok).toBe(true);
    expect(evaluateRateLimit(max, "rate", windowStart, now).ok).toBe(true);
  });

  it("blocks the one past the cap", () => {
    const { max } = rateLimits.rate;
    const verdict = evaluateRateLimit(max + 1, "rate", windowStart, now);
    expect(verdict.ok).toBe(false);
    expect(verdict.remaining).toBe(0);
  });

  it("counts down the remaining allowance", () => {
    const { max } = rateLimits.upload;
    expect(evaluateRateLimit(1, "upload", windowStart, now).remaining).toBe(max - 1);
    expect(evaluateRateLimit(max, "upload", windowStart, now).remaining).toBe(0);
  });

  it("reports retry-after as the time left in the window", () => {
    // 12:30 inside a 12:00–13:00 window leaves half an hour.
    expect(evaluateRateLimit(99, "rate", windowStart, now).retryAfterSec).toBe(1800);
  });

  it("never advertises a zero-second retry", () => {
    // Exactly on the boundary the maths gives 0, which would invite a hot loop.
    const atBoundary = new Date("2026-09-02T13:00:00Z");
    expect(
      evaluateRateLimit(99, "rate", windowStart, atBoundary).retryAfterSec,
    ).toBe(1);
  });

  it("keeps each bucket on its own budget", () => {
    // Reports are a daily allowance; ratings are hourly. Same count, different verdict.
    const count = rateLimits.report.max + 1;
    expect(evaluateRateLimit(count, "report", windowStart, now).ok).toBe(false);
    expect(evaluateRateLimit(count, "rate", windowStart, now).ok).toBe(true);
  });
});
