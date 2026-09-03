"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SpinnerIcon, UserPlusIcon } from "./icons";

/**
 * Follow / Following, as a toggle.
 *
 * Optimistic, and deliberately so: the edge is a single row and the request
 * almost never fails, so waiting on the network to redraw the button makes the
 * whole app feel slower than it is. A failure puts the old state back.
 *
 * The counter next to it is owned by this component once it has been touched.
 * `initialFollowers` is the server's number; after a successful toggle the server
 * sends the fresh count back and that wins, so two tabs cannot drift apart.
 */

interface FollowButtonProps {
  handle: string;
  /** Null means there is nothing to draw — signed out, or your own profile. */
  isFollowing: boolean | null;
  /** Rendered beside the button when given. Omit for a bare button in a list. */
  followersCount?: number;
  size?: "sm" | "md";
  onChange?: (next: { isFollowing: boolean; followersCount: number }) => void;
}

export function FollowButton({
  handle,
  isFollowing,
  followersCount,
  size = "md",
  onChange,
}: FollowButtonProps) {
  const router = useRouter();
  const [following, setFollowing] = useState(isFollowing === true);
  const [count, setCount] = useState(followersCount ?? 0);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  if (isFollowing === null) return null;

  async function toggle() {
    if (busy) return;
    const next = !following;

    // Flipped before the request, including the count, so the number and the
    // button never disagree for the length of a round trip.
    setBusy(true);
    setFollowing(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));

    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, following: next }),
      });
      if (!res.ok) throw new Error("failed");

      const data = (await res.json()) as {
        isFollowing: boolean;
        followersCount: number;
      };
      setFollowing(data.isFollowing);
      setCount(data.followersCount);
      onChange?.(data);

      // The feed blend depends on this edge, so the server's idea of "For you"
      // is now stale. Refreshing in a transition keeps the button interactive
      // while the page catches up.
      startTransition(() => router.refresh());
    } catch {
      setFollowing(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  const height = size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-[13px]";

  return (
    <span className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        className={`flex items-center gap-1.5 rounded-pill font-semibold transition-colors disabled:opacity-60 ${height} ${
          following
            ? "border border-line bg-transparent text-muted hover:border-line-strong hover:text-ink"
            : "bg-ink text-panel hover:opacity-90"
        }`}
      >
        {busy ? (
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          !following && <UserPlusIcon className="h-3.5 w-3.5" />
        )}
        {following ? "Following" : "Follow"}
      </button>

      {followersCount !== undefined && (
        <span className="text-xs tabular-nums text-faint">{count}</span>
      )}
    </span>
  );
}
