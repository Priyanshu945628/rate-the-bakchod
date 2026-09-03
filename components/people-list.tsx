"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientPerson } from "@/lib/types";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";
import { SpinnerIcon } from "./icons";

/**
 * A page of people — followers, following — with the same cursor scroll the feed
 * uses.
 *
 * `mode` and `handle` are passed straight back to `GET /api/people`, so the list
 * does not need to know which of the two directions it is showing beyond that.
 */
export function PeopleList({
  initialPeople,
  initialCursor,
  mode,
  handle,
  empty,
}: {
  initialPeople: ClientPerson[];
  initialCursor: string | null;
  mode: "followers" | "following";
  handle: string;
  empty: string;
}) {
  const [people, setPeople] = useState(initialPeople);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mode, handle, cursor });
      const res = await fetch(`/api/people?${params.toString()}`);
      const data = (await res.json()) as {
        people?: ClientPerson[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load more.");

      setPeople((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.people ?? []).filter((p) => !seen.has(p.id))];
      });
      setCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, mode, handle]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  if (people.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center shadow-card">
        <p className="text-sm text-muted">{empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="panel divide-y divide-line shadow-card">
        {people.map((person) => (
          <li key={person.id}>
            <PersonRow person={person} />
          </li>
        ))}
      </ul>

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
            onClick={() => void loadMore()}
            className="mt-2 h-8 rounded-ctl border border-line px-3 text-xs text-ink hover:border-line-strong"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One person.
 *
 * The second line is the tagline when they wrote one, and the score otherwise —
 * whichever the person actually chose to say about themselves comes first. For the
 * AI it is neither: nothing rates the house account, so it has no score to print
 * and printing a zero would be a lie.
 */
export function PersonRow({ person }: { person: ClientPerson }) {
  const detail = person.isAI
    ? "House account"
    : (person.tagline ??
      (person.bakchodScore > 0
        ? `Bakchod score ${person.bakchodScore.toFixed(2)}`
        : "Unrated"));

  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <Link href={`/u/${person.handle}`} className="shrink-0">
        <Avatar
          src={person.avatarUrl}
          name={person.displayName}
          size={40}
          isAI={person.isAI}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/u/${person.handle}`}
          className="block truncate text-[13px] font-semibold text-ink hover:underline"
        >
          {person.displayName}
        </Link>
        <p className="truncate text-xs text-muted">@{person.handle}</p>
        <p className="truncate text-[11px] text-faint">{person.reason ?? detail}</p>
      </div>

      <FollowButton
        handle={person.handle}
        isFollowing={person.isFollowing}
        size="sm"
      />
    </div>
  );
}
