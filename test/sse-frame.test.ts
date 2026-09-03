import { describe, expect, it } from "vitest";
import { sseFrame } from "@/lib/realtime";
import { REALTIME_EVENT_NAMES, type RealtimeEvent } from "@/lib/types";

/**
 * The wire format.
 *
 * SSE is whitespace-significant in a way that fails silently: a frame missing its
 * blank terminator is buffered by the browser instead of dispatched, and a raw
 * newline inside the payload ends the frame early and delivers half an object.
 * Neither shows up in a type check, and both look like "realtime is a bit flaky"
 * in production, so the format is pinned here.
 */

const notification: RealtimeEvent = {
  type: "notification",
  unread: 3,
  notification: {
    id: "n1",
    kind: "COMMENT",
    text: "Priya commented on your post",
    href: "/p/post1",
    actor: { handle: "priya", displayName: "Priya", avatarUrl: null },
    createdAt: "2026-09-02T10:00:00.000Z",
  },
};

describe("sseFrame", () => {
  it("names the event and terminates with a blank line", () => {
    const frame = sseFrame(notification);
    expect(frame.startsWith("event: notification\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("round-trips the event through the data line", () => {
    const [, data] = sseFrame(notification).split("\ndata: ");
    expect(JSON.parse(data.trimEnd())).toEqual(notification);
  });

  it("keeps a newline in a message body from ending the frame", () => {
    // A DM is free text, so this is the everyday case rather than an attack.
    const event: RealtimeEvent = {
      type: "message",
      conversationId: "conv1",
      unreadConversations: 1,
      message: {
        id: "m1",
        body: "line one\nline two\n\nline three",
        imageUrl: null,
        createdAt: "2026-09-02T10:00:00.000Z",
        author: { id: "u1", handle: "priya", displayName: "Priya" },
      },
    };

    const frame = sseFrame(event);
    // Exactly three: one after `event:`, one after `data:`, one closing the frame.
    expect(frame.split("\n")).toHaveLength(4);
    expect(frame.match(/\n\n/g)).toHaveLength(1);

    const [, data] = frame.split("\ndata: ");
    expect(JSON.parse(data.trimEnd())).toEqual(event);
  });

  it("frames the keep-alive too", () => {
    expect(sseFrame({ type: "ping" })).toBe('event: ping\ndata: {"type":"ping"}\n\n');
  });

  it("emits only names the client is listening for", () => {
    // `EventSource` dispatches by name, so a frame whose `event:` the provider never
    // registered arrives and is dropped without a trace.
    const events: (RealtimeEvent | { type: "ping" })[] = [
      notification,
      { type: "read", conversationId: "conv1", by: "u1", at: "2026-09-02T10:00:00.000Z" },
      { type: "typing", conversationId: "conv1", by: "u1" },
      {
        type: "call",
        callId: "c1",
        conversationId: "conv1",
        kind: "VIDEO",
        phase: "invite",
        from: { id: "u1", handle: "priya", displayName: "Priya", avatarUrl: null },
      },
      { type: "ping" },
    ];

    for (const event of events) {
      const name = sseFrame(event).slice("event: ".length).split("\n")[0];
      expect(REALTIME_EVENT_NAMES, name).toContain(name);
    }
  });

  it("relays a call signal without stringifying it into something else", () => {
    // SDP is a multi-line blob. It is relayed, never stored, so this frame is the
    // only place it has to survive intact.
    const event: RealtimeEvent = {
      type: "call",
      callId: "c1",
      conversationId: "conv1",
      kind: "VOICE",
      phase: "signal",
      from: { id: "u1", handle: "priya", displayName: "Priya", avatarUrl: null },
      signal: { sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n" },
    };

    const frame = sseFrame(event);
    expect(frame.split("\n")).toHaveLength(4);
    const [, data] = frame.split("\ndata: ");
    expect(JSON.parse(data.trimEnd())).toEqual(event);
  });
});
