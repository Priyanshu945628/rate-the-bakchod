import { describe, expect, it } from "vitest";
import { FEED_SCOPE, PROFILE_STAT_COUNTS } from "@/lib/posts";

/**
 * Stories are `Post` rows, so "a post on the feed" now has to be said out loud.
 * This test exists so that saying it stays a single checked constant rather than
 * an `isStory: false` scattered across six query sites with one of them forgotten.
 *
 * The profile stat strip is where forgetting it shows: deleting a post only hides
 * the row, so any count that does not filter keeps counting what the page no
 * longer renders.
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

describe("PROFILE_STAT_COUNTS", () => {
  it("reaches through `post` for the two counts that are not posts", () => {
    // A comment and a rating belong to a post, so their filter has to hop the
    // relation — `{ isHidden: false }` on a Comment would be a field that is not there.
    expect(PROFILE_STAT_COUNTS).toEqual({
      posts: { where: FEED_SCOPE },
      comments: { where: { post: FEED_SCOPE } },
      ratings: { where: { post: FEED_SCOPE } },
    });
  });

  it("counts nothing raw, so a fourth stat cannot ship unfiltered", () => {
    // `comments: true` is the shape of the bug: a count with no `where` keeps
    // counting rows hanging off a post that was deleted.
    for (const [stat, count] of Object.entries(PROFILE_STAT_COUNTS)) {
      const where = (count as { where: Record<string, unknown> }).where;
      expect(where, stat).toBeTypeOf("object");
      expect(where.post ?? where, stat).toEqual(FEED_SCOPE);
    }
  });
});
