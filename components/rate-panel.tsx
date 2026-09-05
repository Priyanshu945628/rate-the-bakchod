"use client";

import { useState } from "react";
import type { ClientPost, ClientViewer } from "@/lib/types";
import { SparkIcon, SpinnerIcon, StarIcon } from "./icons";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * The rating control.
 *
 * One rule shows up in the UI three separate ways: the AI's posts get a badge
 * instead of a slider, the rate endpoint refuses them, and the leaderboard query
 * filters the bot out. The bot's points are never calculated, so there is nothing
 * here to calculate them with.
 */

interface Props {
  post: ClientPost;
  viewer: ClientViewer | null;
  onRated: (patch: { average: number; ratingsCount: number; mine: number }) => void;
}

export function RatePanel({ post, viewer, onRated }: Props) {
  const [value, setValue] = useState(post.viewerRating ?? 5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const own = viewer?.id === post.author.id;
  const rated = post.viewerRating !== null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: post.id, value }),
      });
      const data = (await res.json()) as {
        error?: string;
        postAverage?: number;
        postRatingsCount?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not save that rating.");
        return;
      }
      onRated({
        average: data.postAverage ?? value,
        ratingsCount: data.postRatingsCount ?? post.ratingsCount + 1,
        mine: value,
      });
    } catch {
      setError("Network gave up. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const score = (
    <div className="flex items-baseline gap-1.5">
      <StarIcon className="h-4 w-4 self-center text-muted" />
      <span className="text-[15px] font-semibold text-ink">
        {post.average !== null ? post.average.toFixed(1) : "—"}
      </span>
      <span className="text-xs text-faint">
        {post.ratingsCount === 1 ? "1 rating" : `${post.ratingsCount} ratings`}
      </span>
    </div>
  );

  if (post.isOfficial) {
    // No panel at all. The header badge already says what this is, and a strip
    // reading "not rated" under every announcement is a row of nothing.
    return null;
  }

  if (post.author.isAI) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="flex items-center gap-2 rounded-pill bg-panel-3 px-3 py-1.5 text-xs font-medium text-ink">
          <SparkIcon className="h-4 w-4" />
          House bakchod — never scored
        </span>
        <span className="text-xs text-faint">
          The AI plays, it does not compete.
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {score}

        {!viewer ? (
          <SignInPrompt size="xs">Sign in to rate this bakchod.</SignInPrompt>
        ) : own ? (
          <span className="text-xs text-faint">
            Your own bakchodi. Others decide.
          </span>
        ) : rated ? (
          <span className="rounded-pill bg-panel-3 px-3 py-1.5 text-xs font-medium text-ink">
            You gave {post.viewerRating}/10
          </span>
        ) : null}
      </div>

      {viewer && !own && !rated && (
        <div className="mt-3 flex items-center gap-3">
          <span className="w-9 text-center text-lg font-bold tabular-nums text-ink">
            {value}
          </span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            aria-label="How big a bakchod, 1 to 10"
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex h-9 shrink-0 items-center gap-2 rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            Rate
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
