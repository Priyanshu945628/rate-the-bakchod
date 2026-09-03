"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ClientStoryTray, ClientViewer } from "@/lib/types";
import { Avatar } from "./avatar";
import { StoryComposer, type PostedStory } from "./story-composer";
import { StoryViewer } from "./story-viewer";
import { PlusIcon, SpeakerIcon } from "./icons";

/**
 * The row of story rings above the feed.
 *
 * Ordering is decided on the server (`fetchStoryTrays` puts the viewer's own run
 * first, then unseen, then the rest) so that this component never has to re-sort
 * on a state change and make rings jump around under someone's thumb.
 *
 * The ring is a flat two-pixel border — `ink` when there is something unseen, a
 * line colour when there isn't. No gradient ring, per the standing rule, and not
 * the accent either: the accent is reserved for rank numbers and primary actions,
 * and a row of accent rings would be the loudest thing on the page.
 *
 * Posting is handled here rather than in the composer: the composer hands back the
 * finished story and the preview it was showing, this inserts the ring, and
 * {@link Flight} animates the picture from where the dialog had it down into the
 * ring's slot. Nothing reloads, so the feed underneath does not blink.
 */

interface StoryTrayProps {
  trays: ClientStoryTray[];
  viewer: ClientViewer | null;
}

const FLIGHT_MS = 620;

export function StoryTray({ trays, viewer }: StoryTrayProps) {
  const [rows, setRows] = useState(trays);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [flight, setFlight] = useState<PostedStory | null>(null);
  /** True once a flight has landed, so the ring plays the catch beat exactly once. */
  const [landed, setLanded] = useState(false);

  const selfRing = useRef<HTMLSpanElement | null>(null);

  function open(index: number) {
    setOpenAt(index);
    // Opening a run clears its ring immediately. The POST that records it is
    // fire-and-forget in the viewer, so waiting for a round trip before dimming a
    // ring would just look broken.
    setRows((current) =>
      current.map((tray, i) => (i === index ? { ...tray, hasUnseen: false } : tray)),
    );
  }

  function dropStory(storyId: string) {
    setRows((current) =>
      current
        .map((tray) => ({
          ...tray,
          stories: tray.stories.filter((s) => s.id !== storyId),
        }))
        // A run with nothing left in it is no longer a run.
        .filter((tray) => tray.stories.length > 0),
    );
  }

  function posted(next: PostedStory) {
    // The ring goes in first and the flight starts against it: the destination has
    // to be a real laid-out element before there is anywhere to fly to.
    setRows((current) => withStory(current, next));
    // Cleared first: React has to see the class go before it will play again.
    setLanded(false);
    setFlight(next);
  }

  // Stable for as long as one story is in the air, so the animation is never
  // restarted halfway by an unrelated re-render of the tray.
  const landFlight = useCallback(() => {
    if (!flight) return;
    URL.revokeObjectURL(flight.previewUrl);
    setLanded(true);
    setFlight(null);
  }, [flight]);

  // Nothing to show and nobody signed in to add anything: render nothing rather
  // than an empty strip of chrome.
  if (rows.length === 0 && !viewer) return null;

  return (
    <>
      <section
        aria-label="Stories"
        className="panel no-bar flex gap-3.5 overflow-x-auto px-3.5 py-3 shadow-card"
      >
        {viewer && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex w-[64px] shrink-0 flex-col items-center gap-1.5"
          >
            <span className="relative flex h-[58px] w-[58px] items-center justify-center rounded-pill border border-dashed border-line-strong text-muted transition-colors hover:border-ink hover:text-ink">
              <PlusIcon className="h-5 w-5" />
            </span>
            <span className="w-full truncate text-center text-[10px] font-medium text-muted">
              Add story
            </span>
          </button>
        )}

        {rows.map((tray, index) => {
          const isSelf = viewer?.handle === tray.author.handle;
          const catching = isSelf && flight !== null;

          return (
            <button
              key={tray.author.handle}
              type="button"
              onClick={() => open(index)}
              className="flex w-[64px] shrink-0 flex-col items-center gap-1.5"
            >
              <span
                ref={isSelf ? selfRing : undefined}
                // Hidden, not absent, while a story is on its way to it: the flight
                // needs to measure the slot, and the picture arriving should look
                // like it turned into the ring rather than landing next to one.
                style={catching ? { opacity: 0 } : undefined}
                className={`flex h-[58px] w-[58px] items-center justify-center rounded-pill border-2 p-0.5 transition-colors ${
                  tray.hasUnseen ? "border-ink" : "border-line-strong"
                } ${isSelf && landed ? "story-land" : ""}`}
              >
                <Avatar
                  src={tray.author.avatarUrl}
                  name={tray.author.displayName}
                  size={50}
                  isAI={tray.author.isAI}
                />
              </span>
              <span
                className={`w-full truncate text-center text-[10px] font-medium ${
                  tray.hasUnseen ? "text-ink" : "text-muted"
                }`}
              >
                {isSelf ? "Your story" : tray.author.displayName}
              </span>
            </button>
          );
        })}
      </section>

      {flight && <Flight posted={flight} target={selfRing} onDone={landFlight} />}

      {openAt !== null && (
        <StoryViewer
          trays={rows}
          startTray={openAt}
          onClose={() => setOpenAt(null)}
          selfHandle={viewer?.handle ?? null}
          onDeleted={dropStory}
        />
      )}

      {composing && (
        <StoryComposer onClose={() => setComposing(false)} onPosted={posted} />
      )}
    </>
  );
}

/**
 * The picture, flying from the composer into the ring.
 *
 * A fixed square cropped out of the middle of the preview, scaled down onto the
 * ring's slot while its corners round all the way to a circle. Driven by the Web
 * Animations API rather than a transition because there is no "before" render to
 * transition from — the element appears already in flight.
 *
 * `transform` and `border-radius` only, so nothing here reflows the feed behind it.
 */
function Flight({
  posted,
  target,
  onDone,
}: {
  posted: PostedStory;
  target: RefObject<HTMLSpanElement | null>;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  // The square the flight actually moves: the middle of the preview, so a tall
  // portrait video does not squash on the way down.
  const side = Math.max(24, Math.min(posted.from.width, posted.from.height));
  const left = posted.from.left + (posted.from.width - side) / 2;
  const top = posted.from.top + (posted.from.height - side) / 2;

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const to = target.current?.getBoundingClientRect();
    // No slot to aim at — shrink away where it stands rather than freezing on
    // screen. Not a state anyone should reach, but a stuck overlay would be worse.
    const destination = to ?? new DOMRect(left + side / 2, top + side / 2, 0, 0);
    const scale = destination.width > 0 ? destination.width / side : 0;
    const dx = destination.left - left;
    const dy = destination.top - top;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animation = el.animate(
      [
        { transform: "translate(0px, 0px) scale(1)", borderRadius: "14px" },
        {
          offset: 0.55,
          // A shallow arc: it lifts a little before it drops into the row, which is
          // what stops the move reading as a straight slide.
          transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 26}px) scale(${
            1 + (scale - 1) * 0.62
          })`,
          borderRadius: "999px",
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          borderRadius: "999px",
        },
      ],
      {
        duration: reduced ? 1 : FLIGHT_MS,
        easing: "cubic-bezier(0.32, 0.72, 0.2, 1)",
        fill: "forwards",
      },
    );
    animation.onfinish = onDone;
    return () => {
      // A cancelled animation never fires `finish`, so unmounting mid-flight has to
      // do the finishing itself or the object URL stays pinned for the tab's life.
      if (animation.playState === "finished") return;
      animation.cancel();
      onDone();
    };
  }, [left, top, side, target, onDone]);

  return (
    <div
      ref={box}
      aria-hidden
      style={{
        left,
        top,
        width: side,
        height: side,
        transformOrigin: "top left",
      }}
      className="pointer-events-none fixed z-[60] overflow-hidden bg-panel-2 shadow-pop"
    >
      {posted.previewKind === "VIDEO" ? (
        <video
          src={posted.previewUrl}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : posted.previewKind === "AUDIO" ? (
        // A clip has no picture, so the ring flies as a plain tile.
        <span className="flex h-full w-full items-center justify-center text-muted">
          <SpeakerIcon className="h-1/3 w-1/3" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posted.previewUrl} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

/**
 * The tray with a freshly posted story in it.
 *
 * Appended, not prepended: a run reads oldest-first, the same order the server
 * builds. The author's own run moves to the front, which is where the server would
 * have put it anyway.
 */
function withStory(rows: ClientStoryTray[], posted: PostedStory): ClientStoryTray[] {
  const mine = rows.find((tray) => tray.author.id === posted.author.id);
  if (!mine) {
    return [{ author: posted.author, stories: [posted.story], hasUnseen: true }, ...rows];
  }
  if (mine.stories.some((story) => story.id === posted.story.id)) return rows;

  const updated: ClientStoryTray = {
    ...mine,
    stories: [...mine.stories, posted.story],
    hasUnseen: true,
  };
  return [updated, ...rows.filter((tray) => tray !== mine)];
}
