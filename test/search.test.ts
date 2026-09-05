import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSearchable,
  normalizeQuery,
  parseSearchTab,
  searchHref,
  SEARCH_MIN_CHARS,
  SEARCH_TABS,
} from "@/lib/search";

/**
 * What a search agrees to be, on both sides of the wire.
 *
 * `lib/search.ts` is the only part of search that runs in a browser as well as on the
 * server, and it is why the two halves cannot disagree: the box builds a URL with
 * `searchHref`, the page and the route both read it back with the same two parsers. A
 * `?q=` that normalises differently in one of those places is a search that returns the
 * wrong page and looks like a database problem.
 *
 * The two queries need a database, so what is checked about them here is what a database
 * could not tell us anyway: that `searchPosts` is scoped like the feed, and that
 * `searchPeople` is deliberately not scoped by profile visibility. Read out of the source
 * the same way `ai-endpoints.test.ts` reads `schema.prisma`.
 */

function read(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("normalizeQuery", () => {
  it("takes the first value when the URL repeats `q`", () => {
    expect(normalizeQuery(["bakchod", "other"])).toBe("bakchod");
  });

  it("reads a missing query as an empty one rather than throwing", () => {
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery([])).toBe("");
  });

  it("collapses inner whitespace, because the match is a literal substring", () => {
    // A caption pasted with a double space would otherwise find nothing at all.
    expect(normalizeQuery("  bada   bakchod \n")).toBe("bada bakchod");
  });

  it("caps the length, past which nothing new can match", () => {
    expect(normalizeQuery("x".repeat(200))).toHaveLength(64);
  });

  it("leaves LIKE wildcards alone — they widen a match, they do not escape it", () => {
    expect(normalizeQuery("100%_sure")).toBe("100%_sure");
  });

  it("is idempotent, so re-reading its own URL never changes the query", () => {
    const once = normalizeQuery("  bada   bakchod  ");
    expect(normalizeQuery(once)).toBe(once);
  });
});

describe("isSearchable", () => {
  it("holds until there are two characters to match on", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("b")).toBe(false);
    expect(isSearchable("ba")).toBe(true);
    expect(SEARCH_MIN_CHARS).toBe(2);
  });

  it("agrees with `normalizeQuery` about whitespace, not against it", () => {
    // A box holding one letter and a space is still one letter.
    expect(isSearchable(normalizeQuery("b "))).toBe(false);
  });
});

describe("parseSearchTab", () => {
  it("defaults to posts, which is what a bare /search shows", () => {
    expect(parseSearchTab(null)).toBe("posts");
    expect(parseSearchTab(undefined)).toBe("posts");
    expect(parseSearchTab("")).toBe("posts");
  });

  it("refuses anything that is not a tab, however it arrives", () => {
    // The route names its result array after this value, so an unchecked one would be a
    // key in a JSON response typed straight out of the query string.
    expect(parseSearchTab("users")).toBe("posts");
    expect(parseSearchTab("__proto__")).toBe("posts");
    expect(parseSearchTab(["people", "posts"])).toBe("people");
  });

  it("accepts every tab the strip draws", () => {
    for (const tab of SEARCH_TABS) {
      expect(parseSearchTab(tab.key)).toBe(tab.key);
    }
  });
});

describe("searchHref", () => {
  it("round-trips through the parsers that read it back", () => {
    const href = searchHref("bada bakchod", "people");
    const params = new URL(href, "https://example.com").searchParams;
    expect(normalizeQuery(params.get("q"))).toBe("bada bakchod");
    expect(parseSearchTab(params.get("type"))).toBe("people");
  });

  it("encodes a query that would otherwise end the URL", () => {
    const href = searchHref("a&b=c#d", "posts");
    expect(href).not.toContain("#");
    const params = new URL(href, "https://example.com").searchParams;
    expect(params.get("q")).toBe("a&b=c#d");
  });
});

describe("searchPosts", () => {
  const source = read("lib", "posts.ts");
  const body = source.slice(source.indexOf("export async function searchPosts"));

  it("is scoped like the feed, so a hidden post and a story stay out of results", () => {
    expect(body.slice(0, body.indexOf("orderBy"))).toContain("...FEED_SCOPE");
  });

  it("matches case-insensitively on both the caption and the tweet text", () => {
    const where = body.slice(0, body.indexOf("select:"));
    expect(where).toContain("caption:");
    expect(where).toContain("tweetText:");
    expect(where.match(/mode: "insensitive"/g)).toHaveLength(2);
  });
});

describe("searchPeople", () => {
  const source = read("lib", "follows.ts");
  const body = source.slice(
    source.indexOf("export async function searchPeople"),
    source.indexOf("function matchRank"),
  );

  it("does not filter by profile visibility — the leaderboard does not either", () => {
    // A `SIGNED_IN` profile still appears on the public leaderboard and still renders its
    // name above the locked card, so hiding it from a search would be the only surface in
    // the app pretending that person does not exist.
    expect(body).not.toContain("visibility");
    expect(body).not.toContain("visibilityAllows");
  });

  it("takes its cursor off the database's order, not the ranked one", () => {
    // The rank reshuffles the page in memory; paging from the ranked last row would skip
    // whatever the sort moved past it.
    expect(body.indexOf("const nextCursor")).toBeLessThan(body.indexOf(".sort("));
  });
});
