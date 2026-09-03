"use client";

import { useState } from "react";
import type { ClientAuthor, ClientHighlight, ClientStoryTray } from "@/lib/types";
import { StoryViewer } from "./story-viewer";
import { SpinnerIcon } from "./icons";

/**
 * The circles under a profile header: the person's live stories first, if they have
 * any, then one per saved highlight.
 *
 * A highlight's stories are fetched when it is tapped, not with the page. Someone
 * with a dozen highlights of a hundred stories each would otherwise pay for all of
 * it to draw a dozen circles. The live run is the exception — it is small, capped,
 * and already came down with the profile, so tapping it opens instantly.
 */

interface HighlightRowProps {
  highlights: ClientHighlight[];
  /** For the fallback cover initial and the overlay header. */
  author: ClientAuthor;
  selfHandle: string | null;
  /** This person's currently live stories, or null when they have none. */
  live?: ClientStoryTray | null;
}

export function HighlightRow({
  highlights,
  author,
  selfHandle,
  live = null,
}: HighlightRowProps) {
  const [openTray, setOpenTray] = useState<ClientStoryTray | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (highlights.length === 0 && !live) return null;

  async function open(highlight: ClientHighlight) {
    setLoadingId(highlight.id);
    setError(null);
    try {
      const res = await fetch(`/api/highlights/${encodeURIComponent(highlight.id)}`);
      const body = (await res.json().catch(() => null)) as {
        author?: ClientAuthor;
        stories?: ClientStoryTray["stories"];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not open that.");
      if (!body?.stories?.length) throw new Error("Nothing in there yet.");

      setOpenTray({
        author: body.author ?? author,
        stories: body.stories,
        // A highlight has no unseen state — it is not new, it is kept.
        hasUnseen: false,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that.");
    } finally {
      setLoadingId(null);
    }
  }

  function dropStory(storyId: string) {
    setOpenTray((tray) =>
      tray ? { ...tray, stories: tray.stories.filter((s) => s.id !== storyId) } : null,
    );
  }

  return (
    <>
      <div className="border-t border-line px-4 py-3.5 sm:px-5">
        <ul className="flex gap-3.5 overflow-x-auto">
          {live && (
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => setOpenTray(live)}
                className="flex w-[62px] flex-col items-center gap-1.5"
              >
                {/* Flat `ink` ring, matching the tray on the feed: a lit ring
                    means there is something live in there. */}
                <span
                  className={`flex h-[56px] w-[56px] items-center justify-center overflow-hidden rounded-pill border-2 bg-panel-2 ${
                    live.hasUnseen ? "border-ink" : "border-line-strong"
                  }`}
                >
                  {live.stories[0]?.posterUrl ?? live.stories[0]?.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={live.stories[0].posterUrl ?? live.stories[0].mediaUrl ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-muted">
                      {live.stories.length}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium text-ink">
                  Live
                </span>
              </button>
            </li>
          )}
          {highlights.map((highlight) => (
            <li key={highlight.id} className="shrink-0">
              <button
                type="button"
                onClick={() => open(highlight)}
                disabled={loadingId !== null}
                className="flex w-[62px] flex-col items-center gap-1.5 disabled:opacity-60"
              >
                <span className="flex h-[56px] w-[56px] items-center justify-center overflow-hidden rounded-pill border border-line-strong bg-panel-2">
                  {loadingId === highlight.id ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin text-muted" />
                  ) : highlight.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={highlight.coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-sm font-semibold text-faint">
                      {(highlight.title.trim()[0] ?? "•").toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium text-muted">
                  {highlight.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {openTray && openTray.stories.length > 0 && (
        <StoryViewer
          trays={[openTray]}
          startTray={0}
          onClose={() => setOpenTray(null)}
          selfHandle={selfHandle}
          onDeleted={dropStory}
        />
      )}
    </>
  );
}
