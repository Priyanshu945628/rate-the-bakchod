"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientPost, ClientViewer } from "@/lib/types";
import type { FeedTab } from "@/lib/feed-tabs";
import { FEED_TABS } from "@/lib/feed-tabs";
import { PostCard } from "./post-card";
import { SpinnerIcon } from "./icons";

/**
 * How long ids sit before they are sent. Long enough that a fast scroll past ten
 * cards is one request, short enough that a reader who scrolls once and leaves
 * still counted.
 */
const SEEN_FLUSH_MS = 1500;

/** The server's own per-request cap, so a big batch gets split rather than clipped. */
const SEEN_BATCH_MAX = 60;

/**
 * The feed, with cursor-based infinite scroll.
 *
 * The first page arrives server-rendered; later pages come from
 * `GET /api/posts?tab=&cursor=`. Switching tabs is a real navigation, so the
 * server hands back a fresh first page and the props below reset the list.
 *
 * Signed-in, it also reports which cards actually reached the screen — see the
 * observer below — which is what stops For You from putting the same well-rated post
 * back at the top tomorrow.
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
  const list = useRef<HTMLDivElement | null>(null);
  /** On screen, not sent yet. */
  const pending = useRef<Set<string>>(new Set());
  /** Sent once already: a card scrolled past twice is still one impression. */
  const reported = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerId = viewer?.id ?? null;

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

  /**
   * Send whatever is queued. Named so it can re-arm itself for the remainder when a
   * batch overflows the cap.
   *
   * `keepalive` because this is the one request in the app nobody is waiting for:
   * it has to survive the navigation that usually happens right after it.
   */
  const flushSeen = useCallback(function flush(closing = false) {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }

    const batch = [...pending.current].slice(0, SEEN_BATCH_MAX);
    if (batch.length === 0) return;
    for (const id of batch) pending.current.delete(id);

    // Nothing reads the reply. Losing one costs a repeat in the feed, not correctness.
    void fetch("/api/seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postIds: batch }),
      keepalive: true,
    }).catch(() => {});

    if (!closing && pending.current.size > 0) {
      flushTimer.current = setTimeout(() => flush(), SEEN_FLUSH_MS);
    }
  }, []);

  /**
   * One observer for the whole list rather than one per card: what is recorded is
   * "this was on the screen", and no card needs to know that about itself.
   *
   * No `rootMargin` here on purpose. The pager above deliberately loads the next page
   * 600px early, and a post that was fetched but never scrolled to has not been seen —
   * counting it would retire it from For You unread.
   */
  useEffect(() => {
    const root = list.current;
    if (!viewerId || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let queued = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // It only ever counts once, so it stops being watched the moment it does.
          observer.unobserve(entry.target);
          const id = (entry.target as HTMLElement).dataset.postId;
          if (!id || reported.current.has(id)) continue;
          reported.current.add(id);
          pending.current.add(id);
          queued = true;
        }
        if (queued && flushTimer.current === null) {
          flushTimer.current = setTimeout(() => flushSeen(), SEEN_FLUSH_MS);
        }
      },
      { threshold: 0 },
    );

    for (const node of root.querySelectorAll<HTMLElement>("[data-post-id]")) {
      if (!reported.current.has(node.dataset.postId ?? "")) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [viewerId, posts, flushSeen]);

  // The batch still in hand on the way out. A reader who scrolls once and closes the
  // tab has seen those posts as much as anybody.
  useEffect(() => () => flushSeen(true), [flushSeen]);

  return (
    <div ref={list} className="space-y-3">
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
          // The id is on the wrapper only when recording it means something: your own
          // posts are excluded from For You anyway, so watching them writes rows the
          // ranker will never read.
          <div
            key={post.id}
            data-post-id={post.author.id === viewerId ? undefined : post.id}
          >
            <PostCard
              post={post}
              viewer={viewer}
              // An author deleting their own leaves nothing to render, and no
              // tombstone either — so the card goes rather than turning into one.
              onRemoved={() => setPosts((prev) => prev.filter((p) => p.id !== post.id))}
            />
          </div>
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
