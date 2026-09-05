"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientPerson, ClientPost, ClientViewer } from "@/lib/types";
import { normalizeQuery, searchHref, type SearchTab } from "@/lib/search";
import { PersonRow } from "./people-list";
import { PostCard } from "./post-card";
import { SearchIcon, SpinnerIcon } from "./icons";

/**
 * The search box and the two lists under it.
 *
 * The URL is the state. Typing rewrites `?q=`, the server page re-renders with a fresh
 * first page, and these components only ever fetch to append the *next* one — which is
 * why the box does not hold the results and the lists do not hold the query. It also
 * means a search is a link: shareable, restorable, and back-and-forwardable.
 *
 * `q` and `type` arrive as props rather than out of `useSearchParams`, because the page
 * above is a server component that already has them. That is the documented way round,
 * and it keeps this whole file out of a `Suspense` boundary.
 */

/** How long after the last keystroke the URL changes — one navigation, not one per key. */
const DEBOUNCE_MS = 300;

export function SearchBox({ query, tab }: { query: string; tab: SearchTab }) {
  const router = useRouter();
  const [text, setText] = useState(query);

  // The box follows the URL when the URL moves on its own — Back out of a search, or
  // a tab link that carried a different `q`. Compared and reset during render, the
  // pattern `components/feed.tsx` uses for the same reason: an effect would paint the
  // stale value once first.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    if (normalizeQuery(text) !== query) setText(query);
  }

  useEffect(() => {
    // Already where the URL is: a tab change, or the navigation this box just asked
    // for having landed. Either way there is nothing to replace.
    if (normalizeQuery(text) === query) return;
    const timer = setTimeout(() => {
      // `replace`, not `push`: Back should leave the search, not replay it a letter
      // at a time. `scroll: false` because the results are below the box, and jumping
      // to the top on every keystroke would fight anyone reading them.
      router.replace(searchHref(normalizeQuery(text), tab), { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query, tab, router]);

  return (
    <label className="glass-bar flex items-center gap-2.5 rounded-ctl px-3 py-2.5 focus-within:border-line-strong">
      <SearchIcon className="h-5 w-5 shrink-0 text-faint" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search"
        aria-label="Search posts and people"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="focus-bare w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
      />
    </label>
  );
}

/**
 * The cursor scroll both tabs share.
 *
 * `GET /api/search` names its array after the tab, so `data[tab]` is the rows and one
 * hook covers a list of posts and a list of people without either of them owning a
 * copy of this. Same sentinel, same dedupe and same reset as `components/feed.tsx`.
 */
function useResults<T extends { id: string }>(
  initial: T[],
  initialCursor: string | null,
  query: string,
  tab: SearchTab,
) {
  const [rows, setRows] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // A new query hands down a fresh first page, and everything appended under the old
  // one answers a question nobody asked any more.
  const [lastFirstPage, setLastFirstPage] = useState(initial);
  if (lastFirstPage !== initial) {
    setLastFirstPage(initial);
    setRows(initial);
    setCursor(initialCursor);
    setError(null);
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, type: tab, cursor });
      const res = await fetch(`/api/search?${params.toString()}`);
      const data = (await res.json()) as {
        posts?: ClientPost[];
        people?: ClientPerson[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load more.");
      // The one cast this arrangement costs: the route's key *is* the tab name.
      const more = (data[tab] ?? []) as unknown as T[];

      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...more.filter((r) => !seen.has(r.id))];
      });
      setCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, query, tab]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  /** Take one row out — a post its author just deleted. The query itself stands. */
  const drop = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  return { rows, loading, error, sentinel, loadMore, drop };
}

export function SearchPosts({
  initialPosts,
  initialCursor,
  query,
  viewer,
}: {
  initialPosts: ClientPost[];
  initialCursor: string | null;
  query: string;
  viewer: ClientViewer | null;
}) {
  const { rows, loading, error, sentinel, loadMore, drop } = useResults<ClientPost>(
    initialPosts,
    initialCursor,
    query,
    "posts",
  );

  if (rows.length === 0) return <Nothing />;

  return (
    <div className="space-y-3">
      {rows.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          viewer={viewer}
          onRemoved={() => drop(post.id)}
        />
      ))}
      <Tail loading={loading} error={error} sentinel={sentinel} onRetry={loadMore} />
    </div>
  );
}

export function SearchPeople({
  initialPeople,
  initialCursor,
  query,
}: {
  initialPeople: ClientPerson[];
  initialCursor: string | null;
  query: string;
}) {
  const { rows, loading, error, sentinel, loadMore } = useResults<ClientPerson>(
    initialPeople,
    initialCursor,
    query,
    "people",
  );

  if (rows.length === 0) return <Nothing />;

  return (
    <div className="space-y-2">
      <ul className="panel divide-y divide-line shadow-card">
        {rows.map((person) => (
          <li key={person.id}>
            <PersonRow person={person} />
          </li>
        ))}
      </ul>
      <Tail loading={loading} error={error} sentinel={sentinel} onRetry={loadMore} />
    </div>
  );
}

/**
 * Nothing matched. The same three words the conversation filter uses, and no more than
 * that — a query that found nothing needs an answer, not advice about how to search.
 */
function Nothing() {
  return (
    <div className="panel px-4 py-10 text-center shadow-card">
      <p className="text-sm text-muted">Nothing matches.</p>
    </div>
  );
}

/** The sentinel and what happens around it, identical for both lists. */
function Tail({
  loading,
  error,
  sentinel,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  sentinel: React.RefObject<HTMLDivElement | null>;
  onRetry: () => void;
}) {
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />

      {loading && (
        <p className="flex items-center justify-center gap-2 py-3 text-xs text-faint">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      )}

      {error && (
        <div className="panel px-4 py-3 text-center">
          <p className="text-xs text-danger">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 h-8 rounded-ctl border border-line px-3 text-xs text-ink hover:border-line-strong"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}
