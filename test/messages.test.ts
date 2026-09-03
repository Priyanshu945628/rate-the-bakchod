import { describe, expect, it } from "vitest";
import {
  THREAD_PAGE_SIZE,
  buildThreadPage,
  isUnread,
  pairKey,
  previewOf,
} from "@/lib/messages";

/**
 * The pure half of direct messages.
 *
 * Three of these decide something a user sees and cannot argue with: whether a row
 * is bold, which line sits under a name, and what order a thread happened in. None
 * of them need a database, and all of them are the kind of thing that breaks quietly
 * — a reversed comparison in `isUnread` leaves a dot that never clears, and nobody
 * reports it as a bug because it looks like a design decision.
 *
 * `buildThreadPage` is here because a thread is stitched from two tables. The rule
 * worth pinning down is the last one: a call from before the oldest message on a full
 * page is held back for the next page, because sorting it in would place it above
 * messages that happened after it.
 */

type Msg = Parameters<typeof buildThreadPage>[0][number];
type Call = Parameters<typeof buildThreadPage>[1][number];

const BASE = 1_700_000_000_000;
/** Newest-first, the order both queries return. */
const at = (offset: number) => new Date(BASE - offset * 1000);

const msg = (id: string, offset: number, over: Partial<Msg> = {}): Msg => ({
  id,
  senderId: "me",
  body: `body ${id}`,
  attachmentKey: null,
  createdAt: at(offset),
  deletedAt: null,
  ...over,
});

const call = (id: string, offset: number, over: Partial<Call> = {}): Call => ({
  id,
  kind: "VOICE",
  status: "ENDED",
  callerId: "me",
  startedAt: null,
  endedAt: null,
  createdAt: at(offset),
  ...over,
});

describe("pairKey", () => {
  it("is the same key whichever side asks", () => {
    expect(pairKey("alice", "bob")).toBe(pairKey("bob", "alice"));
  });

  it("separates the two ids", () => {
    expect(pairKey("b", "a")).toBe("a:b");
  });
});

describe("previewOf", () => {
  it("says so when a thread is empty", () => {
    expect(previewOf(null)).toBe("No messages yet");
  });

  it("shows a tombstone instead of the deleted body", () => {
    const body = "the thing I wish I had not said";
    expect(previewOf({ body, attachmentKey: null, deletedAt: at(0) })).toBe("Message deleted");
  });

  it("leaves a short body alone", () => {
    expect(previewOf({ body: "hey", attachmentKey: null, deletedAt: null })).toBe("hey");
  });

  it("truncates a long body with an ellipsis", () => {
    const body = "x".repeat(500);
    const preview = previewOf({ body, attachmentKey: null, deletedAt: null });

    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThan(body.length);
  });

  it("describes an image-only message", () => {
    expect(previewOf({ body: null, attachmentKey: "k", deletedAt: null })).toBe("Photo");
  });
});

describe("isUnread", () => {
  const them = { senderId: "them", createdAt: at(0) };

  it("is not unread when there is nothing in it", () => {
    expect(isUnread(null, null, "me")).toBe(false);
  });

  it("is not unread when I wrote the last message", () => {
    expect(isUnread({ senderId: "me", createdAt: at(0) }, null, "me")).toBe(false);
  });

  it("is unread when they wrote it and I have never opened the thread", () => {
    expect(isUnread(them, null, "me")).toBe(true);
  });

  it("is unread when their message landed after my last read", () => {
    expect(isUnread(them, at(10), "me")).toBe(true);
  });

  it("is read when I opened the thread after their message", () => {
    expect(isUnread({ senderId: "them", createdAt: at(10) }, at(0), "me")).toBe(false);
  });

  it("counts a read at the same instant as read", () => {
    // The read is written after the message on the same clock, so equal means the
    // message was in the thread when it was opened. Flipping this to `>=` would
    // leave a dot on every thread the moment it is read.
    expect(isUnread(them, at(0), "me")).toBe(false);
  });
});

describe("buildThreadPage", () => {
  it("returns entries oldest first, whichever table they came from", () => {
    const { entries } = buildThreadPage(
      [msg("m1", 10), msg("m2", 30)],
      [call("c1", 20)],
      "me",
    );

    expect(entries.map((e) => e.id)).toEqual(["m2", "c1", "m1"]);
  });

  it("marks my own messages and my own calls as mine", () => {
    const { entries } = buildThreadPage(
      [msg("m1", 10), msg("m2", 20, { senderId: "them" })],
      [call("c1", 15), call("c2", 16, { callerId: "them" })],
      "me",
    );

    const message = (id: string) => entries.find((e) => e.id === id && e.entry === "message");
    const ring = (id: string) => entries.find((e) => e.id === id && e.entry === "call");

    expect(message("m1")).toMatchObject({ mine: true });
    expect(message("m2")).toMatchObject({ mine: false });
    expect(ring("c1")).toMatchObject({ direction: "out" });
    expect(ring("c2")).toMatchObject({ direction: "in" });
  });

  it("strips a deleted message rather than sending its body", () => {
    const { entries } = buildThreadPage(
      [msg("m1", 10, { deletedAt: at(5), body: "regrettable", attachmentKey: "k" })],
      [],
      "me",
    );

    expect(entries[0]).toMatchObject({ deleted: true, body: null, imageUrl: null });
  });

  it("serves an attachment from the guarded route", () => {
    const { entries } = buildThreadPage([msg("m1", 10, { attachmentKey: "abc" })], [], "me");

    expect(entries[0]).toMatchObject({ imageUrl: "/api/message-asset/abc" });
  });

  it("gives a duration only to a call that was answered and ended", () => {
    const { entries } = buildThreadPage(
      [],
      [
        call("answered", 10, { startedAt: at(9), endedAt: at(4) }),
        call("missed", 20, { status: "MISSED" }),
      ],
      "me",
    );

    expect(entries.find((e) => e.id === "answered")).toMatchObject({ durationMs: 5000 });
    expect(entries.find((e) => e.id === "missed")).toMatchObject({ durationMs: null });
  });

  const filled = (n: number) => Array.from({ length: n }, (_, i) => msg(`m${i}`, i));

  it("does not offer more when the page is exactly full", () => {
    const { entries, hasMore } = buildThreadPage(filled(THREAD_PAGE_SIZE), [], "me");

    expect(hasMore).toBe(false);
    expect(entries).toHaveLength(THREAD_PAGE_SIZE);
  });

  it("uses the extra row as a probe and does not render it", () => {
    const { entries, hasMore } = buildThreadPage(filled(THREAD_PAGE_SIZE + 1), [], "me");

    expect(hasMore).toBe(true);
    expect(entries).toHaveLength(THREAD_PAGE_SIZE);
    expect(entries.some((e) => e.id === `m${THREAD_PAGE_SIZE}`)).toBe(false);
  });

  it("holds back a call from before the oldest message on a full page", () => {
    const { entries } = buildThreadPage(
      filled(THREAD_PAGE_SIZE + 1),
      [call("older", THREAD_PAGE_SIZE + 10), call("boundary", THREAD_PAGE_SIZE - 1)],
      "me",
    );

    expect(entries.some((e) => e.id === "older")).toBe(false);
    expect(entries.some((e) => e.id === "boundary")).toBe(true);
  });

  it("keeps every call when the thread has no messages to bound them", () => {
    const { entries, hasMore } = buildThreadPage([], [call("c1", 900), call("c2", 5)], "me");

    expect(entries.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(hasMore).toBe(false);
  });

  it("offers more on a thread of nothing but calls", () => {
    // No message means no probe row, so the call count has to carry the decision or
    // two people who only ever ring each other can never scroll back.
    const calls = Array.from({ length: THREAD_PAGE_SIZE }, (_, i) => call(`c${i}`, i));

    expect(buildThreadPage([], calls, "me").hasMore).toBe(true);
  });
});
