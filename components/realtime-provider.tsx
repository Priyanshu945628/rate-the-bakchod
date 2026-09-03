"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { REALTIME_EVENT_NAMES, type RealtimeEvent } from "@/lib/types";

/**
 * One `EventSource` for the whole app.
 *
 * The bell, the message list, an open thread and an incoming call all want the
 * same stream. Each opening its own would be four connections per tab, and
 * browsers cap concurrent SSE connections per origin at six — a user with two tabs
 * would start losing streams silently. So the provider holds the single connection
 * and hands out subscriptions.
 *
 * Subscribers get *every* event and filter for themselves. That is deliberate: the
 * alternative is a registry keyed by event type, which is more machinery for no
 * gain when a page has three listeners.
 */

type Handler = (event: RealtimeEvent) => void;

interface RealtimeApi {
  /** Register a handler. Returns the unsubscribe — call it from an effect cleanup. */
  subscribe: (handler: Handler) => () => void;
  /** Whether the stream is currently up. Signed-out sessions are never up. */
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeApi>({
  subscribe: () => () => {},
  connected: false,
});

/**
 * `enabled` is the signed-in check, passed down from the server rather than
 * inferred here: a signed-out browser opening the stream would get a 401, and
 * `EventSource` responds to that by retrying forever.
 */
export function RealtimeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const handlers = useRef<Set<Handler>>(new Set());
  const [connected, setConnected] = useState(false);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource("/api/realtime");

    // Every state write below sits inside a listener the effect *attached*, not in
    // the effect body — which is the shape the effect lint requires and the reason
    // this is a pile of `addEventListener` calls rather than a tidy async helper.
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));

    for (const name of REALTIME_EVENT_NAMES) {
      if (name === "ping") {
        // A ping proves the stream is alive and carries nothing else. It is also
        // the first frame the route sends, so it is what actually flips `connected`
        // true behind a proxy that swallows the open event.
        source.addEventListener(name, () => setConnected(true));
        continue;
      }
      source.addEventListener(name, (raw) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse((raw as MessageEvent<string>).data) as RealtimeEvent;
        } catch {
          return;
        }
        // A snapshot, because a handler is allowed to unsubscribe itself — mutating
        // the live set mid-iteration would skip whoever came after it.
        for (const handler of [...handlers.current]) {
          try {
            handler(event);
          } catch (err) {
            console.error("[realtime] handler failed:", err);
          }
        }
      });
    }

    return () => source.close();
  }, [enabled]);

  const api = useMemo<RealtimeApi>(() => ({ subscribe, connected }), [subscribe, connected]);

  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}

/**
 * Subscribe to the stream for the life of a component.
 *
 * The handler is kept in a ref so a caller can pass an inline arrow without
 * re-subscribing on every render — which, with a `useEffect` dependency on the
 * function itself, is a subscribe/unsubscribe loop on each keystroke elsewhere on
 * the page.
 */
export function useRealtime(handler: Handler): void {
  const { subscribe } = useContext(RealtimeContext);
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

export function useRealtimeConnected(): boolean {
  return useContext(RealtimeContext).connected;
}
