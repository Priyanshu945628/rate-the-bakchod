import { describe, expect, it } from "vitest";
import {
  STORY_TTL_MS,
  isStoryLive,
  liveStoryFilter,
  storyExpiresAt,
  storyTimeLeftMs,
} from "@/lib/story-window";

const T0 = new Date("2026-09-02T00:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe("storyExpiresAt", () => {
  it("is one day after creation", () => {
    expect(STORY_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(storyExpiresAt(T0).toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("isStoryLive", () => {
  const plain = { storyExpiresAt: storyExpiresAt(T0), highlightId: null };

  it("is live inside the window", () => {
    expect(isStoryLive(plain, T0)).toBe(true);
    expect(isStoryLive(plain, hours(23))).toBe(true);
  });

  it("is not live once the window has passed", () => {
    expect(isStoryLive(plain, hours(25))).toBe(false);
  });

  it("expires exactly at the boundary, not a moment after", () => {
    expect(isStoryLive(plain, hours(24))).toBe(false);
    expect(isStoryLive(plain, new Date(hours(24).getTime() - 1))).toBe(true);
  });

  it("stays live forever once it is in a highlight — the point of a highlight", () => {
    const highlighted = { storyExpiresAt: storyExpiresAt(T0), highlightId: "h1" };
    expect(isStoryLive(highlighted, hours(25))).toBe(true);
    expect(isStoryLive(highlighted, hours(24 * 365))).toBe(true);
  });

  it("treats a missing expiry as permanent, matching the DB CHECK", () => {
    // The constraint only permits a null expiry on a non-story, so this is the
    // fail-open branch: never hide something because a column was unexpectedly null.
    expect(isStoryLive({ storyExpiresAt: null, highlightId: null }, hours(999))).toBe(true);
  });
});

describe("liveStoryFilter", () => {
  it("asks for stories that are neither hidden nor past their clock", () => {
    const filter = liveStoryFilter(T0);
    expect(filter.isStory).toBe(true);
    expect(filter.isHidden).toBe(false);
    expect(filter.storyExpiresAt).toEqual({ gt: T0 });
  });

  it("expresses expiry as a query, not as a deletion", () => {
    // Nothing here mutates anything: an expired story stops matching and that is
    // all. Its bytes and wrapped key survive until the owner highlights or deletes
    // it, so "add that to a highlight tomorrow" stays possible.
    expect(Object.keys(liveStoryFilter(T0)).sort()).toEqual([
      "isHidden",
      "isStory",
      "storyExpiresAt",
    ]);
  });
});

describe("storyTimeLeftMs", () => {
  it("counts down and floors at zero", () => {
    const plain = { storyExpiresAt: storyExpiresAt(T0), highlightId: null };
    expect(storyTimeLeftMs(plain, T0)).toBe(STORY_TTL_MS);
    expect(storyTimeLeftMs(plain, hours(21))).toBe(3 * 3_600_000);
    expect(storyTimeLeftMs(plain, hours(30))).toBe(0);
  });

  it("has no countdown for a highlighted story", () => {
    expect(
      storyTimeLeftMs({ storyExpiresAt: storyExpiresAt(T0), highlightId: "h1" }, hours(30)),
    ).toBe(Infinity);
  });
});
