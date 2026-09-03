/**
 * When a story counts as live.
 *
 * Kept in its own module with no server dependencies so the expiry rules can be
 * unit-tested directly. Importing `lib/stories.ts` in a test would drag in Prisma
 * and sharp for the sake of two comparisons.
 *
 * The rule in one sentence: a story is live until `storyExpiresAt`, unless it has
 * been promoted into a highlight, in which case it is live forever.
 */

import { limits } from "./config";

export const STORY_TTL_MS = limits.storyTtlMs;

/** The expiry a story created at `createdAt` should carry. */
export function storyExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + STORY_TTL_MS);
}

export interface StoryWindow {
  storyExpiresAt: Date | null;
  highlightId: string | null;
}

/**
 * Whether a story row is still viewable.
 *
 * Highlight membership wins over the clock, which is the entire point of a
 * highlight. A row with no expiry at all is treated as permanent rather than as
 * expired — failing open here matches the DB CHECK constraint, which only permits
 * a null expiry on a non-story.
 */
export function isStoryLive(story: StoryWindow, now: Date = new Date()): boolean {
  if (story.highlightId !== null) return true;
  if (story.storyExpiresAt === null) return true;
  return story.storyExpiresAt.getTime() > now.getTime();
}

/**
 * Prisma `where` fragment for "stories currently in the tray".
 *
 * Expiry is not destructive: an expired story simply stops matching this. The
 * bytes and the wrapped key survive until the owner promotes it to a highlight or
 * deletes it explicitly — auto-shredding on a timer would make "add that to a
 * highlight tomorrow" impossible, and irreversible deletion is not something to
 * do on a schedule.
 */
export function liveStoryFilter(now: Date = new Date()) {
  return {
    isStory: true,
    isHidden: false,
    storyExpiresAt: { gt: now },
  } as const;
}

/** Milliseconds left, floored at zero. Drives the "3h left" label. */
export function storyTimeLeftMs(story: StoryWindow, now: Date = new Date()): number {
  if (story.highlightId !== null || story.storyExpiresAt === null) return Infinity;
  return Math.max(0, story.storyExpiresAt.getTime() - now.getTime());
}
