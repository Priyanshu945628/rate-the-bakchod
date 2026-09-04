"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientStory, ClientStoryTray } from "@/lib/types";
import { Avatar } from "./avatar";
import { TimeAgo } from "./time-ago";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "./icons";
import { MediaPlayer } from "./media-player";
import { readSwipe } from "./swipe";

/**
 * Full-screen story viewer: one person's run at a time, then straight on to the
 * next person's, then closed.
 *
 * The progress bars are CSS animations rather than state that ticks — sixty
 * re-renders a second of a component holding a `<video>` is how you get a viewer
 * that stutters. JS only fires once per story, to advance. `mark seen` is fired
 * once per story id per mount and never awaited, because whether the ring clears
 * is not worth making somebody wait for.
 *
 * The controls follow the pointer that is on the device. A tap anywhere on the frame
 * holds the story and the next tap lets it run again; a swipe pages. With a mouse
 * there is nothing to swipe with, so arrows sit at the edges of the frame instead.
 */

/** How long a still frame holds. Videos and clips use their own duration. */
const IMAGE_MS = 5000;
/** A clip with no measured duration still has to advance eventually. */
const FALLBACK_MS = 8000;

interface StoryViewerProps {
  trays: ClientStoryTray[];
  /** Which tray to open on. */
  startTray: number;
  onClose: () => void;
  /** The viewer's own handle, so their own run offers a delete affordance. */
  selfHandle: string | null;
  /** Called after a delete so the tray above can drop the story. */
  onDeleted?: (storyId: string) => void;
}

function holdMs(story: ClientStory): number {
  if (story.kind === "IMAGE" || story.kind === "TWEET") return IMAGE_MS;
  return story.durationMs && story.durationMs > 0 ? story.durationMs : FALLBACK_MS;
}

export function StoryViewer({
  trays,
  startTray,
  onClose,
  selfHandle,
  onDeleted,
}: StoryViewerProps) {
  const [trayIndex, setTrayIndex] = useState(() =>
    Math.min(Math.max(startTray, 0), Math.max(trays.length - 1, 0)),
  );
  const [storyIndex, setStoryIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  /** Where a touch started, so where it ends can be read as a tap or a swipe. */
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  /** Set by a swipe, so the click it may end in does not also hold the story. */
  const swipedRef = useRef(false);

  const tray = trays[trayIndex];
  const run = tray?.stories ?? [];
  // Clamped during render rather than corrected in an effect. A run shrinks under
  // us whenever its owner deletes the story they are looking at, and deriving the
  // index means the next frame is already the right one — no flash of nothing, no
  // extra render to fix up state.
  const idx = Math.min(storyIndex, Math.max(run.length - 1, 0));
  const story = run[idx];
  const isOwn = tray != null && selfHandle === tray.author.handle;

  // Paging is written as plain reads of the current indices rather than as state
  // updaters, because moving to the next person's run means setting *two* pieces of
  // state and sometimes closing the overlay — none of which belongs inside an
  // updater function, which React is free to call twice.
  const advance = useCallback(() => {
    setError(null);
    if (idx + 1 < run.length) {
      setStoryIndex(idx + 1);
    } else if (trayIndex + 1 < trays.length) {
      setTrayIndex(trayIndex + 1);
      setStoryIndex(0);
    } else {
      onClose();
    }
  }, [trayIndex, idx, run.length, trays.length, onClose]);

  const rewind = useCallback(() => {
    setError(null);
    if (idx > 0) {
      setStoryIndex(idx - 1);
    } else if (trayIndex > 0) {
      const previous = trayIndex - 1;
      setTrayIndex(previous);
      setStoryIndex(Math.max((trays[previous]?.stories.length ?? 1) - 1, 0));
    }
  }, [trayIndex, idx, trays]);

  // A tray can empty out entirely — someone deleting their only story. There is
  // nothing to page to at that point, so leaving is the only sane move, and the
  // parent owns that.
  useEffect(() => {
    if (!story) onClose();
  }, [story, onClose]);

  // Mark seen, once per story, fire-and-forget. A 429 here is fine and silent:
  // the rate limit on views is generous, and the worst outcome is a ring that
  // stays lit.
  useEffect(() => {
    if (!story || !selfHandle) return;
    if (seenRef.current.has(story.id)) return;
    seenRef.current.add(story.id);
    void fetch(`/api/stories/${encodeURIComponent(story.id)}`, {
      method: "POST",
    }).catch(() => {});
  }, [story, selfHandle]);

  // The clock. Keyed on the story id so a re-render mid-story does not restart it,
  // and skipped entirely while paused or while a video owns its own pacing.
  useEffect(() => {
    if (!story || paused) return;
    const timer = window.setTimeout(advance, holdMs(story));
    return () => window.clearTimeout(timer);
  }, [story, paused, advance]);

  // Keyboard: arrows page, Space holds, Escape leaves.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        rewind();
      } else if (event.key === " ") {
        // Only from the shell itself, which is what holds focus on open. Once focus is
        // on a control, Space is that control's click — the player's own play button
        // flips this same flag, and handling the key here as well would cancel it out.
        if (event.target !== shellRef.current) return;
        event.preventDefault();
        setPaused((p) => !p);
      } else if (event.key === "Tab") {
        // Focus trap. The overlay covers the page, so tabbing out of it would put
        // the caret on a feed nobody can see.
        //
        // Filtered by `offsetParent`, which is null for anything displayed away: the
        // edge arrows are `hidden` below `md`, and handing focus to one of those is a
        // Tab that appears to do nothing and a trap with no way round it.
        const focusable = Array.from(
          shellRef.current?.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])",
          ) ?? [],
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, rewind, onClose]);

  // Hold the page still underneath, and put focus inside so the first Tab lands here.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    shellRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function remove() {
    if (!story) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not delete that.");
      }
      onDeleted?.(story.id);
      // No `advance()` here. The tray drops the row, the clamp above lands on
      // whatever is now in this slot, and calling advance as well would skip one.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that.");
    } finally {
      setBusy(false);
    }
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    // A second finger cancels the gesture instead of restarting it. A pinch lifts one
    // finger at a time, and each of those would otherwise read as a stray drag.
    const point = event.touches.length === 1 ? event.touches[0] : undefined;
    touchRef.current = point ? { x: point.clientX, y: point.clientY } : null;
    swipedRef.current = false;
  }

  function onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const from = touchRef.current;
    const point = event.changedTouches[0];
    touchRef.current = null;
    if (!from || !point) return;
    const swipe = readSwipe(point.clientX - from.x, point.clientY - from.y);
    if (!swipe) return;
    swipedRef.current = true;
    if (swipe === "next") advance();
    else rewind();
  }

  /** Hold the story, or let it run on. */
  function hold() {
    // A swipe ends in a click on most touch browsers, and that click must not hold
    // the story it just paged to. Cleared here as well as on the next touch, so a
    // swipe that fires no click costs nothing.
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    setPaused((p) => !p);
  }

  const duration = story ? holdMs(story) : 0;

  if (!tray || !story) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Stories from ${tray.author.displayName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-3"
    >
      <div
        ref={shellRef}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[420px] flex-col outline-none"
      >
        {/* Progress: one segment per story, filled behind, animating on the current
            one, empty ahead. */}
        <div className="flex gap-1 px-0.5">
          {tray.stories.map((s, i) => (
            <div
              key={s.id}
              className="h-0.5 flex-1 overflow-hidden rounded-pill bg-ink/25"
            >
              <div
                className={`h-full bg-ink ${i === idx ? "story-fill" : ""}`}
                style={
                  i === idx
                    ? {
                        animationDuration: `${duration}ms`,
                        animationPlayState: paused ? "paused" : "running",
                      }
                    : { width: i < idx ? "100%" : "0%" }
                }
              />
            </div>
          ))}
        </div>

        <header className="flex items-center gap-2.5 px-0.5 py-3">
          <Link
            href={`/u/${encodeURIComponent(tray.author.handle)}`}
            onClick={onClose}
            className="flex min-w-0 items-center gap-2.5"
          >
            <Avatar
              src={tray.author.avatarUrl}
              name={tray.author.displayName}
              size={34}
              isAI={tray.author.isAI}
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {tray.author.displayName}
              </span>
              <span className="block text-[11px] text-muted">
                <TimeAgo iso={story.createdAt} />
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            {isOwn && story.viewsCount !== null && (
              <span className="flex h-8 items-center gap-1.5 rounded-pill bg-panel px-2.5 text-[11px] font-medium text-muted">
                <EyeIcon className="h-3.5 w-3.5" />
                Seen by {story.viewsCount}
              </span>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                aria-label="Delete this story"
                className="flex h-8 w-8 items-center justify-center rounded-pill bg-panel text-muted transition-colors hover:text-danger disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close stories"
              className="flex h-8 w-8 items-center justify-center rounded-pill bg-panel text-muted transition-colors hover:text-ink"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div
          className="relative flex-1 overflow-hidden rounded-card bg-black"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <StoryFrame
            story={story}
            paused={paused}
            onPausedChange={setPaused}
            onEnded={advance}
          />

          {/*
            The whole frame is the hold button, so one press stops the picture, the
            segment bar and the advance timer together. No z-index on it, deliberately:
            the player's own play and speaker sit at `z-10`, so they stay above this and
            keep taking their own presses instead of being swallowed by it.
          */}
          <button
            type="button"
            onClick={hold}
            aria-label={paused ? "Resume story" : "Hold story"}
            className="absolute inset-0 flex items-center justify-center"
          >
            {paused ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-pill bg-black/45 text-ink">
                <PlayIcon className="h-8 w-8" />
              </span>
            ) : null}
          </button>

          {/* Arrows for a pointer that cannot swipe. On a phone the frame is 390px of
              picture and every one of those pixels already means hold, so paging there
              is the swipe instead. */}
          <button
            type="button"
            onClick={rewind}
            aria-label="Previous story"
            className="absolute left-1.5 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-pill bg-black/45 text-ink/70 transition-colors hover:bg-black/70 hover:text-ink md:flex"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={advance}
            aria-label="Next story"
            className="absolute right-1.5 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-pill bg-black/45 text-ink/70 transition-colors hover:bg-black/70 hover:text-ink md:flex"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>

          {story.caption && (
            // `pointer-events-none` because the band sits over the hold surface and a
            // captioned story must not have a strip along the bottom that ignores
            // taps. No z-index either: the player's own controls are `z-10` and a
            // caption that paints over the speaker button is a story you cannot
            // unmute.
            <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-4 py-3 text-center text-sm leading-relaxed break-words text-ink">
              {story.caption}
            </p>
          )}
        </div>

        {error && <p className="px-0.5 py-2 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The frame itself. Split out so that changing story id remounts the element
 * rather than swapping its `src` — reusing one `<video>` across sources leaves the
 * previous frame on screen while the next one buffers.
 */
function StoryFrame({
  story,
  paused,
  onPausedChange,
  onEnded,
}: {
  story: ClientStory;
  paused: boolean;
  /**
   * A clip's own play button reports here rather than pausing itself, so one press
   * stops the picture, the segment bar and the advance timer together.
   */
  onPausedChange: (paused: boolean) => void;
  onEnded: () => void;
}) {
  if (!story.mediaUrl) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        {story.caption ?? "This story has no media."}
      </div>
    );
  }

  if (story.kind === "VIDEO") {
    return (
      <MediaPlayer
        key={story.id}
        kind="VIDEO"
        variant="story"
        src={story.mediaUrl}
        poster={story.posterUrl}
        autoPlay
        // Muted on open, because a story that shouts at you is the thing everybody
        // hates. The speaker button in the corner gives the volume back.
        startMuted
        paused={paused}
        onPausedChange={onPausedChange}
        onEnded={onEnded}
        className="h-full w-full"
      />
    );
  }

  if (story.kind === "AUDIO") {
    // No frame to show, so the caption carries it and the clip plays out loud —
    // muting an audio story would leave nothing at all.
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-sm leading-relaxed break-words text-ink">
          {story.caption ?? "Audio"}
        </p>
        <MediaPlayer
          key={story.id}
          kind="AUDIO"
          variant="story"
          src={story.mediaUrl}
          autoPlay
          paused={paused}
          onPausedChange={onPausedChange}
          onEnded={onEnded}
          // Lifted over the viewer's hold surface, which is a later sibling of this
          // whole frame and would otherwise take the presses meant for play and mute.
          // A video story's cluster is already `z-10` for the same reason.
          className="z-10"
        />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={story.id}
      src={story.mediaUrl}
      alt={story.caption ?? "Story"}
      className="h-full w-full object-contain"
      decoding="async"
    />
  );
}
