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
  TrashIcon,
  XIcon,
} from "./icons";
import { MediaPlayer } from "./media-player";

/**
 * Full-screen story viewer: one person's run at a time, then straight on to the
 * next person's, then closed.
 *
 * The progress bars are CSS animations rather than state that ticks — sixty
 * re-renders a second of a component holding a `<video>` is how you get a viewer
 * that stutters. JS only fires once per story, to advance. `mark seen` is fired
 * once per story id per mount and never awaited, because whether the ring clears
 * is not worth making somebody wait for.
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
        const focusable = shellRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
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

        <div className="relative flex-1 overflow-hidden rounded-card bg-black">
          <StoryFrame
            story={story}
            paused={paused}
            onPausedChange={setPaused}
            onEnded={advance}
          />

          {/* Tap zones. Buttons rather than divs so the whole thing works from a
              keyboard as well, and labelled because they are otherwise invisible. */}
          <button
            type="button"
            onClick={rewind}
            aria-label="Previous story"
            className="absolute inset-y-0 left-0 flex w-1/4 items-center justify-start pl-1.5 text-ink/0 transition-colors hover:text-ink/70"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={advance}
            aria-label="Next story"
            className="absolute inset-y-0 right-0 flex w-1/4 items-center justify-end pr-1.5 text-ink/0 transition-colors hover:text-ink/70"
          >
            <ChevronRightIcon className="h-6 w-6" />
          </button>

          {story.caption && (
            <p className="absolute inset-x-0 bottom-0 bg-black/70 px-4 py-3 text-center text-sm leading-relaxed break-words text-ink">
              {story.caption}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-0.5 py-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="h-8 rounded-pill bg-panel px-3 text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            {paused ? "Resume" : "Hold"}
          </button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
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
