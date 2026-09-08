"use client";

import { useState } from "react";
import type { ClientPoll, ClientViewer } from "@/lib/types";
import { SpinnerIcon } from "./icons";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * The options on a POLL post.
 *
 * The tally is shown to everybody from the start, the way the rating strip shows an
 * average before you have rated: it is a public number either way, and hiding it
 * until you answer turns a question into a toll.
 *
 * A vote can be moved — tapping another option repoints it — so every row stays a
 * live button after answering rather than freezing into a result. The server's tally
 * replaces this copy outright on every answer, because between the render and the tap
 * it moved for reasons that had nothing to do with this reader.
 *
 * Nothing in here scores anything. That is what lets the house account ask a question
 * and be answered without a single point being calculated: see `submitPollVote`.
 */
export function PollView({
  postId,
  poll: initial,
  viewer,
}: {
  postId: string;
  poll: ClientPoll;
  viewer: ClientViewer | null;
}) {
  const [poll, setPoll] = useState(initial);
  /** The option currently in flight, so only its own row shows the spinner. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(optionId: string) {
    // Already there. The endpoint answers a double tap with the tally rather than an
    // error, so this is only saving the round trip.
    if (!viewer || busy !== null || optionId === poll.viewerOptionId) return;

    setBusy(optionId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        options?: { id: string; votes: number }[];
        totalVotes?: number;
        viewerOptionId?: string;
      };
      if (!res.ok || !data.options) {
        setError(data.error ?? "Could not record that.");
        return;
      }

      // Matched by id rather than by index: the labels stay in the author's order
      // here, and the response is only ever a set of counts.
      const counts = new Map(data.options.map((o) => [o.id, o.votes]));
      setPoll((p) => {
        const options = p.options.map((o) => ({ ...o, votes: counts.get(o.id) ?? o.votes }));
        return {
          options,
          totalVotes: data.totalVotes ?? options.reduce((n, o) => n + o.votes, 0),
          viewerOptionId: data.viewerOptionId ?? optionId,
        };
      });
    } catch {
      setError("Network gave up. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 pb-4">
      <div role="group" aria-label="Poll" className="space-y-2">
        {poll.options.map((option) => {
          const picked = option.id === poll.viewerOptionId;
          const share =
            poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void vote(option.id)}
              disabled={!viewer || busy !== null}
              aria-pressed={picked}
              className={`relative flex w-full items-center gap-3 overflow-hidden rounded-ctl border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                picked
                  ? "border-line-strong"
                  : "border-line enabled:hover:border-line-strong"
              }`}
            >
              {/* The share, drawn behind the label. Flat wash, no track underneath:
                  the row's own border is the 100% mark. */}
              <span
                aria-hidden
                style={{ width: `${share}%` }}
                className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${
                  picked ? "bg-accent/15" : "bg-panel-3"
                }`}
              />
              <span
                className={`relative min-w-0 flex-1 break-words text-sm ${
                  picked ? "font-medium text-ink" : "text-ink/90"
                }`}
              >
                {option.label}
              </span>
              {busy === option.id ? (
                <SpinnerIcon className="relative h-4 w-4 shrink-0 animate-spin text-muted" />
              ) : (
                <span className="relative shrink-0 text-xs font-medium tabular-nums text-muted">
                  {share}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-xs text-faint">
          {poll.totalVotes === 1 ? "1 vote" : `${poll.totalVotes} votes`}
        </span>
        {!viewer && <SignInPrompt size="xs">Sign in to answer.</SignInPrompt>}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
