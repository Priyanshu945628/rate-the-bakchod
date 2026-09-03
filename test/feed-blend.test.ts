import { describe, expect, it } from "vitest";
import { blendFeed, type FeedPool } from "@/lib/posts";
import { feedBlend } from "@/lib/config";

/**
 * The For You mix.
 *
 * `blendFeed` is the only part of the algorithm that is pure, and it is the part
 * that is easy to get subtly wrong — an off-by-one in the slot arithmetic turns
 * 3:1 into 1:1 and nobody notices for a week. The ratio lives in `lib/config.ts`,
 * so these read it rather than hard-coding 3 and 1; what is asserted is the shape
 * the constant produces, not the constant itself.
 *
 * The load-bearing test is the last one. Offset paging only works because a deeper
 * fetch of the same pools blends to a list beginning with the shallower one, and
 * that property is exactly what breaks if the blend ever borrows across a
 * truncated pool.
 */

const rows = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

/** A pool the database had nothing more to give. */
const whole = <T,>(items: T[]): FeedPool<T> => ({ items, complete: true });
/** A pool cut off by its `take` — there is more behind it. */
const cut = <T,>(items: T[]): FeedPool<T> => ({ items, complete: false });

describe("blendFeed", () => {
  it("takes followed:discovery in the configured ratio", () => {
    const out = blendFeed(cut(rows("f", 40)), cut(rows("d", 40)), cut([]));
    const cycle = feedBlend.followed + feedBlend.discovery;

    out.forEach((post, slot) => {
      const wantFollowed = slot % cycle < feedBlend.followed;
      expect(post.id.startsWith(wantFollowed ? "f" : "d")).toBe(true);
    });
    expect(out.length).toBeGreaterThan(cycle * 4);
  });

  it("is deterministic — the same pools always blend to the same list", () => {
    const build = () =>
      blendFeed(whole(rows("f", 12)), whole(rows("d", 12)), whole(rows("n", 12)));
    expect(build()).toEqual(build());
  });

  it("never repeats a post, even when the pools overlap", () => {
    const shared = rows("s", 6);
    const out = blendFeed(whole(shared), whole(shared), whole(shared));
    expect(out.map((p) => p.id)).toEqual(shared.map((p) => p.id));
  });

  it("gives a brand-new account a full feed from discovery alone", () => {
    // Follows nobody: pool one is genuinely empty and the blend has to fall
    // through rather than emitting a page of holes.
    const out = blendFeed(whole([]), whole(rows("d", 10)), whole([]));
    expect(out).toHaveLength(10);
  });

  it("falls through to fresh once the other two are genuinely spent", () => {
    const out = blendFeed(whole(rows("f", 2)), whole(rows("d", 1)), whole(rows("n", 5)));
    const ids = out.map((p) => p.id);
    expect(ids).toHaveLength(8);
    expect(ids.filter((id) => id.startsWith("f"))).toHaveLength(2);
    expect(ids.filter((id) => id.startsWith("d"))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith("n"))).toHaveLength(5);
  });

  it("stops at a truncated pool instead of borrowing across the cut", () => {
    // Two followed posts and no more fetched, but there *are* more behind the
    // take. Reaching past them for a discovery post would put a row in a slot
    // that a deeper fetch would have filled differently.
    const out = blendFeed(cut(rows("f", 2)), whole(rows("d", 9)), whole(rows("n", 9)));
    expect(out.map((p) => p.id)).toEqual(["f0", "f1"]);
  });

  it("returns nothing when there is nothing anywhere", () => {
    expect(blendFeed(whole([]), whole([]), whole([]))).toEqual([]);
  });

  it("blends a deeper fetch into a list that starts with the shallower one", () => {
    // The property offset paging rests on. Both pools are truncated at the
    // shallow depth, which is the case that used to shift every row.
    const shallow = blendFeed(cut(rows("f", 6)), cut(rows("d", 6)), cut(rows("n", 6)));
    const deep = blendFeed(cut(rows("f", 24)), cut(rows("d", 24)), cut(rows("n", 24)));
    expect(deep.slice(0, shallow.length)).toEqual(shallow);
    expect(deep.length).toBeGreaterThan(shallow.length);
  });

  it("serves a whole page from pools fetched only one page deep", () => {
    // What `fetchForYou` relies on when it fetches `need` rows per pool: the
    // blend must be able to emit `need` items before it hits a cut.
    const need = 13;
    const out = blendFeed(
      cut(rows("f", need)),
      cut(rows("d", need)),
      cut(rows("n", need)),
    );
    expect(out.length).toBeGreaterThanOrEqual(need);
  });
});

describe("feedBlend", () => {
  it("keeps followed posts in the majority", () => {
    expect(feedBlend.followed).toBeGreaterThan(feedBlend.discovery);
    expect(feedBlend.discovery).toBeGreaterThan(0);
  });
});
