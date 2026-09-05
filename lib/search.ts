/**
 * What counts as a search, shared by the page, the route and the box you type into.
 *
 * The two queries themselves live next to the reads they mirror — `searchPosts` in
 * `lib/posts.ts` beside the feed, `searchPeople` in `lib/follows.ts` beside the follow
 * lists — because each one reuses that module's select and its cursor. Both of those are
 * server-only, so the parsing that the client input also needs lives here instead, the
 * same split `lib/feed-tabs.ts` makes for the feed.
 */

export type SearchTab = "posts" | "people";

export const SEARCH_TABS: { key: SearchTab; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "people", label: "People" },
];

const KEYS = new Set<string>(SEARCH_TABS.map((t) => t.key));

export function parseSearchTab(raw: string | string[] | null | undefined): SearchTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && KEYS.has(value) ? (value as SearchTab) : "posts";
}

/**
 * How short a query may be before nothing runs.
 *
 * One letter matches most of the table, so the page it would return is not an answer
 * — and it is a state every search passes through on the way to being typed.
 */
export const SEARCH_MIN_CHARS = 2;

/** Past this nothing new matches: it is longer than any handle and most captions. */
const MAX_CHARS = 64;

/**
 * The query as both halves agree to read it.
 *
 * Whitespace is collapsed as well as trimmed, because the match is a literal
 * substring — a double space pasted out of a caption would otherwise find nothing and
 * look like a broken search rather than a stray keystroke.
 *
 * `%` and `_` are left alone. They reach Postgres as part of a bound parameter, so the
 * worst a wildcard can do is widen a match that is already `%term%`.
 */
export function normalizeQuery(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}

export function isSearchable(query: string): boolean {
  return query.length >= SEARCH_MIN_CHARS;
}

/** The URL for one search. The only place either half builds one. */
export function searchHref(query: string, tab: SearchTab): string {
  const params = new URLSearchParams({ q: query, type: tab });
  return `/search?${params.toString()}`;
}
