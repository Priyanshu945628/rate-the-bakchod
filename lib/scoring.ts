/**
 * Bakchod Score.
 *
 * A plain average lets one lucky 10/10 outrank someone consistently rated 8
 * across fifty posts, so ratings are smoothed toward the global mean until a
 * user has enough of them to have earned their position. This is the standard
 * IMDb weighted-rating shape.
 *
 *   score = (v / (v + m)) * R  +  (m / (v + m)) * C
 *
 *   R = this user's mean rating      v = ratings they have received
 *   m = smoothing constant (10)      C = global mean across all non-AI ratings
 *
 * Pure functions only — no imports from the DB — so this is directly testable.
 */

import { SCORE_SMOOTHING, SCORE_PRIOR_MEAN } from "./config";

/** Global mean C, falling back to the prior when nothing has been rated yet. */
export function globalMean(totalSum: number, totalCount: number): number {
  if (totalCount <= 0) return SCORE_PRIOR_MEAN;
  return totalSum / totalCount;
}

/**
 * Weighted score for a user.
 * Returns 0 for someone with no ratings at all — they are unranked, not average.
 */
export function bakchodScore(
  ratingsSum: number,
  ratingsCount: number,
  mean: number,
  smoothing: number = SCORE_SMOOTHING,
): number {
  if (ratingsCount <= 0) return 0;
  const R = ratingsSum / ratingsCount;
  const v = ratingsCount;
  const m = smoothing;
  return (v / (v + m)) * R + (m / (v + m)) * mean;
}

/**
 * Trending rank. Recent attention decays with age so the tab keeps moving
 * instead of ossifying around whatever went big once.
 */
export function hotScore(recentRatings: number, createdAt: Date, now: Date = new Date()): number {
  const hours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  return recentRatings / Math.pow(hours + 2, 1.5);
}

/** Clamp and validate a user-submitted rating. Returns null if out of range. */
export function parseRatingValue(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}
