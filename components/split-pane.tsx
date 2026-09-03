"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * Two panes with a divider you can drag.
 *
 * The width lives outside React, in a module-level map backed by `localStorage`, and
 * is read through `useSyncExternalStore` — the same shape `time-ago.tsx` uses, and for
 * the same reason: the server has no `localStorage`, so the first paint has to render
 * the default and the stored value has to arrive without a state write in an effect.
 *
 * The drag uses pointer capture rather than window listeners. Once the separator owns
 * the pointer, every move and the release come back to it as ordinary React events, so
 * there is nothing to attach and nothing to clean up — and a pointer that leaves the
 * window mid-drag still reports where it went.
 *
 * The width is handed down as a custom property rather than applied to a pane here,
 * because the panes do not both exist at every width: below `lg` they swap, one of
 * them is `hidden`, and whichever is showing wants the whole screen. A pane opts in
 * with `lg:w-[var(--split-w)]`, which by construction cannot affect the narrow layout.
 */

const KEY = (name: string) => `split:${name}`;

const widths = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * The current width, hydrating from storage on the first client read.
 *
 * Memoised into `widths` because `useSyncExternalStore` calls this on every render and
 * compares what it gets: a value that came back fresh from `localStorage` each time
 * would still be equal, but it would also mean a synchronous storage read per render.
 */
function read(name: string, fallback: number): number {
  const held = widths.get(name);
  if (held !== undefined) return held;

  let value = fallback;
  try {
    const stored = Number(window.localStorage.getItem(KEY(name)));
    if (Number.isFinite(stored) && stored > 0) value = stored;
  } catch {
    // Storage can be denied outright. A default width is not worth an error.
  }
  widths.set(name, value);
  return value;
}

/** Move the divider. In memory only — a drag is dozens of these. */
function set(name: string, value: number): void {
  if (widths.get(name) === value) return;
  widths.set(name, value);
  for (const notify of listeners.get(name) ?? []) notify();
}

/** Remember where it was let go of. */
function persist(name: string): void {
  const value = widths.get(name);
  if (value === undefined) return;
  try {
    window.localStorage.setItem(KEY(name), String(value));
  } catch {
    // As above: a width that does not survive a reload is not a failure worth raising.
  }
}

function subscribe(name: string, notify: () => void): () => void {
  const held = listeners.get(name) ?? new Set<() => void>();
  listeners.set(name, held);
  held.add(notify);
  return () => {
    held.delete(notify);
  };
}

/** The stored width, clamped to what this caller allows. */
function useSplitWidth(name: string, initial: number, min: number, max: number): number {
  const listen = useCallback((notify: () => void) => subscribe(name, notify), [name]);
  const stored = useSyncExternalStore(
    listen,
    () => read(name, initial),
    // The server renders the default. Anything else and the first paint would disagree
    // with the markup it replaces.
    () => initial,
  );
  return clamp(stored, min, max);
}

const STEP = 16;

/**
 * `name` is the storage key, so two split surfaces do not share a width. `min` and
 * `max` are applied on read as well as on drag: they can change between releases, and
 * a width saved under the old pair should not be able to strand a pane off-screen.
 */
export function SplitPane({
  name,
  initial,
  min,
  max,
  label,
  className = "",
  first,
  second,
}: {
  name: string;
  initial: number;
  min: number;
  max: number;
  /** What the divider is between, for a screen reader: "Conversation list width". */
  label: string;
  className?: string;
  first: React.ReactNode;
  second: React.ReactNode;
}) {
  const width = useSplitWidth(name, initial, min, max);
  const [dragging, setDragging] = useState(false);
  // Where the pointer went down, and how wide the pane was then: the drag is a delta
  // from that, not from wherever the pointer happens to be over the divider.
  const from = useRef({ x: 0, width: initial });

  function nudge(to: number) {
    set(name, clamp(to, min, max));
    persist(name);
  }

  return (
    <div
      className={`${className} ${dragging ? "cursor-col-resize select-none" : ""}`}
      style={{ "--split-w": `${width}px` } as React.CSSProperties}
    >
      {first}

      {/*
        Hidden below `lg`, where there is no split to adjust — the panes take turns
        there. A separator is a range widget when it can be focused, which is why it
        carries the three values as well as the role.
      */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          from.current = { x: e.clientX, width };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          set(name, clamp(from.current.width + e.clientX - from.current.x, min, max));
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
          persist(name);
        }}
        // Back to where it started. The one gesture people already try on a divider.
        onDoubleClick={() => nudge(initial)}
        onKeyDown={(e) => {
          const to =
            e.key === "ArrowLeft"
              ? width - STEP
              : e.key === "ArrowRight"
                ? width + STEP
                : e.key === "Home"
                  ? min
                  : e.key === "End"
                    ? max
                    : null;
          if (to === null) return;
          e.preventDefault();
          nudge(to);
        }}
        className="group hidden w-3 shrink-0 cursor-col-resize touch-none items-center justify-center lg:flex"
      >
        {/* The grip is 3px of line; the 12px hit area around it is the gap the panes
            would have had anyway, spent on something you can grab. */}
        <span
          className={`h-8 w-[3px] rounded-pill transition-colors ${
            dragging ? "bg-line-strong" : "bg-line group-hover:bg-line-strong"
          }`}
        />
      </div>

      {second}
    </div>
  );
}

