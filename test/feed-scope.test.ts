import { describe, expect, it } from "vitest";
import { FEED_SCOPE } from "@/lib/posts";

/**
 * Stories are `Post` rows, so "a post on the feed" now has to be said out loud.
 * This test exists so that saying it stays a single checked constant rather than
 * an `isStory: false` scattered across six query sites with one of them forgotten.
 */
describe("FEED_SCOPE", () => {
  it("excludes both hidden posts and stories", () => {
    expect(FEED_SCOPE).toEqual({ isHidden: false, isStory: false });
  });

  it("names exactly those two flags — a third would need a deliberate decision", () => {
    expect(Object.keys(FEED_SCOPE).sort()).toEqual(["isHidden", "isStory"]);
  });

  it("spreads into a Prisma where clause without dropping a caller's own keys", () => {
    const where = { ...FEED_SCOPE, author: { handle: "someone" } };
    expect(where).toEqual({
      isHidden: false,
      isStory: false,
      author: { handle: "someone" },
    });
  });
});
