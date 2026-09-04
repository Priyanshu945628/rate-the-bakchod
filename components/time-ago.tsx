"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Relative timestamps.
 *
 * The server and the browser evaluate "now" at different moments, so a
 * server-rendered "2m ago" would not match the client's first render. The fix is
 * `useSyncExternalStore`: its third argument is used for both the server render
 * *and* hydration, so both agree on the absolute date, and the relative label
 * takes over on the first tick afterwards.
 *
 * Every formatter below pins its locale and time zone. `toLocaleDateString()`
 * with the ambient locale is a hydration mismatch waiting to happen — Node's
 * default locale and time zone are not the visitor's.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TICK_MS = 30_000;

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const fullStamp = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function absolute(from: Date): string {
  return dayMonth.format(from);
}

function relative(from: Date): string {
  const delta = Date.now() - from.getTime();
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return absolute(from);
}

/**
 * One interval for every timestamp on the page rather than one per row — a feed
 * of twelve posts should not hold twelve timers.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  timer ??= setInterval(() => {
    for (const listener of listeners) listener();
  }, TICK_MS);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  // Strings are compared with Object.is, so returning an unchanged label between
  // ticks is stable and does not re-render.
  const getSnapshot = useCallback(() => relative(new Date(iso)), [iso]);
  const getServerSnapshot = useCallback(() => absolute(new Date(iso)), [iso]);
  const label = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <time
      dateTime={iso}
      title={`${fullStamp.format(new Date(iso))} UTC`}
      className={className}
    >
      {label}
    </time>
  );
}

/**
 * Whether `iso` is within `withinMs` of now — presence, essentially.
 *
 * It lives here to borrow the shared tick, and to borrow the hydration trick with
 * it: a bare `Date.now()` in a component's body is evaluated once on the server and
 * again in the browser, and "Active now" on one side against "Last seen 2m ago" on
 * the other is a mismatch. The server snapshot is `false`, so both renders agree on
 * the quieter label and the first tick promotes it.
 */
export function useRecent(iso: string | null, withinMs: number): boolean {
  const getSnapshot = useCallback(() => {
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() < withinMs;
  }, [iso, withinMs]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * A wall-clock stamp, for a message bubble.
 *
 * "3m ago" is right for a feed, where the question is how fresh a post is, and wrong
 * inside a conversation, where you are reading a sequence and want to know when each
 * line was said. No timer either: this label never changes, so there is nothing to
 * tick.
 *
 * UTC, pinned, like every other formatter here — the alternative is a hydration
 * mismatch on any visitor whose zone differs from the server's.
 */
export function ClockTime({ iso, className }: { iso: string; className?: string }) {
  const at = new Date(iso);
  return (
    <time dateTime={iso} title={`${fullStamp.format(at)} UTC`} className={className}>
      {clock.format(at)}
    </time>
  );
}

const dayFull = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** The UTC calendar day an ISO stamp falls on. `2026-09-03`, and nothing else. */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function dayName(iso: string): string {
  const key = utcDay(iso);
  const now = Date.now();
  if (key === new Date(now).toISOString().slice(0, 10)) return "Today";
  if (key === new Date(now - DAY).toISOString().slice(0, 10)) return "Yesterday";
  return dayFull.format(new Date(iso));
}

/**
 * The divider between two days of a conversation.
 *
 * This one *does* read the clock on both sides of hydration, unlike `TimeAgo` above,
 * and that is safe for the reason `TimeAgo` is not: the label only changes at
 * midnight UTC, so the server's "now" and the browser's have to straddle that one
 * instant to disagree. In exchange it borrows the shared tick, which is what makes
 * "Today" become "Yesterday" in a thread left open overnight instead of lying until
 * a reload.
 */
export function DayLabel({ iso, className }: { iso: string; className?: string }) {
  const snapshot = useCallback(() => dayName(iso), [iso]);
  const label = useSyncExternalStore(subscribe, snapshot, snapshot);

  return (
    <time dateTime={utcDay(iso)} className={className}>
      {label}
    </time>
  );
}
