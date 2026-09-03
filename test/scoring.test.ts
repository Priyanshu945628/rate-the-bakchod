import { describe, expect, it } from "vitest";
import {
  bakchodScore,
  globalMean,
  hotScore,
  parseRatingValue,
} from "@/lib/scoring";
import { SCORE_PRIOR_MEAN, SCORE_SMOOTHING } from "@/lib/config";

describe("globalMean", () => {
  it("falls back to the prior when nothing has been rated", () => {
    expect(globalMean(0, 0)).toBe(SCORE_PRIOR_MEAN);
    expect(globalMean(100, 0)).toBe(SCORE_PRIOR_MEAN);
  });

  it("is a plain mean once ratings exist", () => {
    expect(globalMean(70, 10)).toBe(7);
  });
});

describe("bakchodScore", () => {
  it("returns 0 for someone with no ratings — unranked, not average", () => {
    expect(bakchodScore(0, 0, 5.5)).toBe(0);
  });

  it("barely moves on a single perfect rating", () => {
    // (1/11)*10 + (10/11)*5.5
    expect(bakchodScore(10, 1, 5.5)).toBeCloseTo(5.909, 3);
  });

  it("approaches the true mean as volume grows", () => {
    // 50 ratings averaging 8.0: (50/60)*8 + (10/60)*5.5
    expect(bakchodScore(400, 50, 5.5)).toBeCloseTo(7.583, 3);
    // 500 ratings averaging 8.0 sits much closer to 8.
    expect(bakchodScore(4000, 500, 5.5)).toBeCloseTo(7.951, 3);
  });

  it("ranks consistency above one lucky 10 — the whole point of smoothing", () => {
    const oneTen = bakchodScore(10, 1, 5.5);
    const fiftyEights = bakchodScore(400, 50, 5.5);
    expect(fiftyEights).toBeGreaterThan(oneTen);
  });

  it("uses the configured smoothing constant by default", () => {
    expect(bakchodScore(80, 10, 5.5)).toBeCloseTo(
      bakchodScore(80, 10, 5.5, SCORE_SMOOTHING),
      10,
    );
  });

  it("pulls towards whatever the global mean actually is", () => {
    // Same ratings, harsher site: the smoothed score drops with C.
    const lenient = bakchodScore(90, 10, 7);
    const harsh = bakchodScore(90, 10, 3);
    expect(lenient).toBeGreaterThan(harsh);
  });

  it("never exceeds the range of its inputs", () => {
    const score = bakchodScore(100, 10, 5.5);
    expect(score).toBeLessThanOrEqual(10);
    expect(score).toBeGreaterThanOrEqual(5.5);
  });
});

describe("hotScore", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("prefers the newer post when attention is equal", () => {
    const fresh = hotScore(10, new Date(now.getTime() - 1 * 3_600_000), now);
    const stale = hotScore(10, new Date(now.getTime() - 48 * 3_600_000), now);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("prefers the busier post when age is equal", () => {
    const createdAt = new Date(now.getTime() - 6 * 3_600_000);
    expect(hotScore(20, createdAt, now)).toBeGreaterThan(
      hotScore(5, createdAt, now),
    );
  });

  it("is zero with no recent ratings, whatever the age", () => {
    expect(hotScore(0, new Date(now.getTime() - 3_600_000), now)).toBe(0);
  });

  it("does not blow up on a clock skew that puts the post in the future", () => {
    const future = new Date(now.getTime() + 10 * 3_600_000);
    const score = hotScore(5, future, now);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe("parseRatingValue", () => {
  it("accepts whole numbers 1 through 10, as strings too", () => {
    expect(parseRatingValue(1)).toBe(1);
    expect(parseRatingValue(10)).toBe(10);
    expect(parseRatingValue("7")).toBe(7);
  });

  it("rejects anything outside the slider", () => {
    expect(parseRatingValue(0)).toBeNull();
    expect(parseRatingValue(11)).toBeNull();
    expect(parseRatingValue(-3)).toBeNull();
    expect(parseRatingValue(7.5)).toBeNull();
    expect(parseRatingValue("eight")).toBeNull();
    expect(parseRatingValue(null)).toBeNull();
    expect(parseRatingValue(undefined)).toBeNull();
    expect(parseRatingValue(Number.NaN)).toBeNull();
    expect(parseRatingValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
