import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { sseFrame, subscribe, type RealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one open connection every live feature hangs off.
 *
 * Server-Sent Events rather than a WebSocket: everything pushed here goes one way
 * — notifications, new messages, read receipts, call signalling — and the client
 * already has `fetch` for the other direction. SSE also reconnects by itself,
 * which is most of what a socket wrapper would have been for.
 *
 * One stream per tab, addressed to the signed-in user. There is no channel to
 * name and no room to join: `subscribe(user.id, …)` is the entire authorisation
 * story, so there is no filter to forget and no way to ask for someone else's
 * events.
 */

/**
 * How often a comment frame goes out.
 *
 * Proxies and phone radios drop a connection that says nothing. Railway's edge is
 * the one that matters here; 25 seconds is comfortably inside the usual 30–60
 * second idle window, and a ping is also how the client notices a stream that has
 * quietly died.
 */
const PING_MS = 25_000;

/** Presence resolution. Bumping `lastSeenAt` more often than this is pure write load. */
const PRESENCE_MS = 60_000;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in first.", 401);
  const userId = user.id;

  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let lastSeen = 0;

  /**
   * Presence, such as it is: one column, bumped from the heartbeat.
   *
   * Fire-and-forget on purpose — an online dot is not worth failing a stream over,
   * and it must not be awaited inside the ping tick or a slow database would start
   * stretching the heartbeat interval.
   */
  function touch() {
    const now = Date.now();
    if (now - lastSeen < PRESENCE_MS) return;
    lastSeen = now;
    prisma.user
      .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
      .catch(() => {
        /* A missed heartbeat is not worth a log line every minute. */
      });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let open = true;

      /**
       * Enqueue one frame, tolerating a stream that has already gone.
       *
       * `cancel` fires when the browser navigates away, but a listener can still be
       * mid-flight when it does, and `controller.enqueue` on a closed stream throws.
       * Swallowing that here is what keeps a closed tab from turning into an
       * unhandled rejection inside whatever write triggered the event.
       */
      function send(event: RealtimeEvent | { type: "ping" }) {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event)));
        } catch {
          open = false;
        }
      }

      // A first frame straight away: it flushes any proxy that buffers until it
      // has seen output, so the client's `onopen` is honest about being connected.
      send({ type: "ping" });
      touch();

      unsubscribe = subscribe(userId, send);
      ping = setInterval(() => {
        send({ type: "ping" });
        touch();
      }, PING_MS);

      // Belt and braces. `cancel` is the documented path, but an aborted request
      // does not always reach it, and a leaked listener would keep publishing into
      // a stream nobody is reading.
      request.signal.addEventListener("abort", () => {
        open = false;
        cleanup();
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-store`: a proxy that gzips this
      // buffers it, and a buffered event stream is not an event stream.
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nginx-family proxies buffer by default and this is the opt-out. Harmless
      // where nothing reads it.
      "x-accel-buffering": "no",
    },
  });
}
