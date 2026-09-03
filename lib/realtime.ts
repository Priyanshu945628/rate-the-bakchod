import "server-only";

/**
 * The realtime bus.
 *
 * Every live feature in the app — the bell, unread message counts, a thread that
 * updates while you read it, an incoming call — is one publish and one listener
 * away from here. There is no external broker.
 *
 * Why not Supabase Realtime: every table in this database is behind deny-all RLS
 * and Prisma connects as the owner, which is exempt. Realtime subscribes as the
 * *user*, so it sees nothing, and opening the tables up enough for it to work
 * would undo the reason the policies are there. Broadcast would work but puts
 * message contents through a third party that does not need them.
 *
 * Why an in-process map is enough: the app runs as one long-lived Node process on
 * Railway. Both ends of every event are in that process, so a publish is a
 * function call. If this ever runs on more than one replica, this file is the
 * seam — the same `publish`/`subscribe` pair backed by Postgres `LISTEN/NOTIFY`
 * or Redis, and nothing above it changes.
 *
 * Events are addressed per user, never broadcast. A subscriber only ever receives
 * events for the id it subscribed with, so there is no filtering to forget on the
 * way out and no way to receive somebody else's.
 */

import type { RealtimeEvent } from "./types";

/**
 * Re-exported so server code keeps finding the event union beside the bus that
 * carries it. The shape itself is declared in `lib/types.ts`, which is Prisma-free
 * and importable from a client component — this module is not.
 */
export type { RealtimeEvent };

type Listener = (event: RealtimeEvent) => void;

/**
 * Open connections, by user id.
 *
 * A `Set` per user because one person is routinely two tabs and a phone, and all
 * of them should light up. Values are the per-connection send functions; the map
 * entry is deleted when the last one closes so an idle process holds nothing.
 *
 * Hung on `globalThis` for the same reason the Prisma client is: `next dev`
 * hot-reloads this module and a fresh `Map` would orphan every open stream.
 */
const registry: Map<string, Set<Listener>> =
  (globalThis as { __rtbRealtime?: Map<string, Set<Listener>> }).__rtbRealtime ??
  ((globalThis as { __rtbRealtime?: Map<string, Set<Listener>> }).__rtbRealtime =
    new Map());

/**
 * Start receiving events for one user. Returns the unsubscribe.
 *
 * The caller is responsible for calling it — `app/api/realtime/route.ts` does so
 * from the stream's `cancel`, which fires when the browser goes away.
 */
export function subscribe(userId: string, listener: Listener): () => void {
  let set = registry.get(userId);
  if (!set) {
    set = new Set();
    registry.set(userId, set);
  }
  set.add(listener);

  return () => {
    const current = registry.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) registry.delete(userId);
  };
}

/**
 * Send an event to one user's open connections.
 *
 * Never throws and never rejects. A publish is a side effect of something more
 * important — a rating, a message — and a dead socket must not fail the write that
 * triggered it. A listener that throws is logged and skipped.
 */
export function publish(userId: string, event: RealtimeEvent): void {
  const set = registry.get(userId);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      console.error("[realtime] listener failed:", err);
    }
  }
}

/** Publish to several people at once — a group thread, a call ended by either end. */
export function publishTo(userIds: Iterable<string>, event: RealtimeEvent): void {
  for (const id of userIds) publish(id, event);
}

/** Whether anyone is currently listening. Used to skip work nobody will see. */
export function hasListener(userId: string): boolean {
  return (registry.get(userId)?.size ?? 0) > 0;
}

/**
 * Serialise one event as an SSE frame.
 *
 * Exported because `test/sse-frame.test.ts` covers it: a frame that forgets its
 * blank terminator, or that lets a newline inside JSON split the payload, breaks
 * the stream in a way that is invisible until it is live. `JSON.stringify` escapes
 * newlines, which is exactly why the payload goes out as JSON and not as text.
 */
export function sseFrame(event: RealtimeEvent | { type: "ping" }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
