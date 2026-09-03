/**
 * Feed tab metadata, shared by the server page and the client tab strip.
 *
 * `lib/posts.ts` is server-only (it imports Prisma and the media pipeline), so
 * the tab list lives here where a client component can import it safely.
 */

export type FeedTab = "foryou" | "fresh" | "top" | "trending";

export const FEED_TABS: { key: FeedTab; label: string; needsViewer?: boolean }[] = [
  // For You is first because it is the default for anyone signed in. It is also
  // the only tab that means nothing signed out — there is no graph to blend — so
  // the strip drops it rather than showing a tab that would render Fresh.
  { key: "foryou", label: "For you", needsViewer: true },
  { key: "fresh", label: "Fresh" },
  { key: "top", label: "Top" },
  { key: "trending", label: "Trending" },
];

const KEYS = new Set<string>(FEED_TABS.map((t) => t.key));

/**
 * Read the tab out of a query string.
 *
 * `fallback` is what a missing or unrecognised value becomes, and the caller
 * decides it because the answer depends on who is asking: a signed-in visitor
 * lands on For You, a signed-out one on Fresh.
 */
export function parseTab(
  raw: string | string[] | null | undefined,
  fallback: FeedTab = "fresh",
): FeedTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && KEYS.has(value) ? (value as FeedTab) : fallback;
}
