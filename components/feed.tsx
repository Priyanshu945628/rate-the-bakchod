"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientPost, ClientViewer } from "@/lib/types";
import type { FeedTab } from "@/lib/feed-tabs";
import { FEED_TABS } from "@/lib/feed-tabs";
import { PostCard } from "./post-card";
import { SpinnerIcon } from "./icons";

/**
 * The feed, with cursor-based infinite scroll.
 *
 * The first page arrives server-rendered; later pages come from
 * `GET /api/posts?tab=&cursor=`. Switching tabs is a real navigation, so the
 * server hands back a fresh first page and the props below reset the list.
 *
 * Pass `author` to scope it to one handle — that is the profile page, and it
 * drops the tab strip because Fresh/Top/Trending are feed-level ideas.
 */
export function Feed({
  initialPosts,
  initialCursor,
  tab,
  viewer,
  author = null,
}: {
  initialPosts: ClientPost[];
  initialCursor: string | null;
  tab: FeedTab;
  viewer: ClientViewer | null;
  author?: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // A server refresh — a new post, or a tab change — hands down a fresh first
  // page, and the appended pages below it are no longer valid. Comparing against
  // the last props we saw and resetting *during* render is the documented way to
  // do that; an effect would paint the stale list once and then immediately
  // repaint, which is the cascade the compiler lint objects to.
  const [lastFirstPage, setLastFirstPage] = useState(initialPosts);
  if (lastFirstPage !== initialPosts) {
    setLastFirstPage(initialPosts);
    setPosts(initialPosts);
    setCursor(initialCursor);
    setError(null);
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab, cursor });
      if (author) params.set("author", author);
      const res = await fetch(`/api/posts?${params.toString()}`);
      const data = (await res.json()) as {
        posts?: ClientPost[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load more.");

      setPosts((prev) => {
        // The cursor is stable, but a post inserted mid-scroll could still
        // overlap. Dedupe by id rather than trust the window.
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.posts ?? []).filter((p) => !seen.has(p.id))];
      });
      setCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, tab, author]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  return (
    <div className="space-y-3">
      {!author && (
        <nav className="glass-bar flex gap-1 rounded-ctl p-1">
          {FEED_TABS.filter((t) => !t.needsViewer || viewer).map((t) => (
            <Link
              key={t.key}
              // Explicit `?tab=` on every one, including the signed-in default:
              // bare `/` means "For you" to a signed-in visitor and "Fresh" to a
              // signed-out one, so a link that relied on it would be ambiguous.
              href={`/?tab=${t.key}`}
              scroll={false}
              aria-current={tab === t.key ? "page" : undefined}
              className={`flex-1 rounded-[10px] py-2 text-center text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-panel-3 text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {posts.length === 0 ? (
        <div className="panel px-4 py-10 text-center shadow-card">
          <p className="text-sm text-muted">
            {author
              ? "No bakchodi on record yet."
              : "Nothing here yet. Be the first to expose a bakchod."}
          </p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard key={post.id} post={post} viewer={viewer} />
        ))
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      {loading && (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-faint">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          Loading more bakchodi…
        </p>
      )}

      {error && (
        <div className="panel px-4 py-3 text-center">
          <p className="text-xs text-danger">{error}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="mt-2 h-8 rounded-ctl border border-line px-3 text-xs text-ink hover:border-line-strong"
          >
            Retry
          </button>
        </div>
      )}

      {!cursor && posts.length > 0 && (
        <p className="py-4 text-center text-xs text-faint">
          That is all the bakchodi for now.
        </p>
      )}
    </div>
  );
}
