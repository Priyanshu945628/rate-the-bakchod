import { describe, expect, it } from "vitest";
import { toEntry } from "@/lib/calls";
import { buildThreadPage } from "@/lib/messages";

/**
 * The one piece of calling that is pure, and the one piece that is written twice.
 *
 * `lib/calls.ts` describes a finished call for the stream; `buildThreadPage` describes
 * the same row after a reload. They cannot share the code — `lib/calls.ts` imports
 * `lib/messages.ts`, so the borrowing can only go one way — which means the only thing
 * keeping them honest is a test that holds them against each other. Drift here is
 * invisible in the worst way: a call appended live would read differently from the same
 * call after a refresh, and nobody would call that a bug.
 */

const BASE = 1_700_000_000_000;
const at = (offset: number) => new Date(BASE - offset * 1000);

type Source = Parameters<typeof toEntry>[0];

const row = (over: Partial<Source> = {}): Source => ({
  id: "c1",
  callerId: "me",
  kind: "VOICE",
  status: "ENDED",
  startedAt: null,
  endedAt: null,
  createdAt: at(0),
  ...over,
});

/** The same row through the other module, so the two shapes can be compared directly. */
function throughThread(source: Source, viewerId: string) {
  const { entries } = buildThreadPage([], [{ ...source }], viewerId);
  const [entry] = entries;
  if (!entry || entry.entry !== "call") throw new Error("expected one call entry");
  const { entry: _kind, ...rest } = entry;
  return rest;
}

describe("toEntry", () => {
  it("reads a call as outgoing for the caller and incoming for the other side", () => {
    expect(toEntry(row(), "me")).toMatchObject({ direction: "out" });
    expect(toEntry(row(), "them")).toMatchObject({ direction: "in" });
  });

  it("gives a duration only once a call was both answered and ended", () => {
    expect(toEntry(row({ startedAt: at(9), endedAt: at(4) }), "me").durationMs).toBe(5000);
    expect(toEntry(row({ status: "MISSED" }), "me").durationMs).toBeNull();
    // Answered and still up: there is no length yet, and zero would read as one.
    expect(toEntry(row({ status: "ACCEPTED", startedAt: at(9) }), "me").durationMs).toBeNull();
  });

  it("sends the stamp as an ISO string, because a Date does not survive JSON", () => {
    expect(toEntry(row(), "me").createdAt).toBe(at(0).toISOString());
  });

  it("agrees with buildThreadPage on every state, from both sides", () => {
    const cases: Source[] = [
      row({ status: "RINGING" }),
      row({ status: "ACCEPTED", startedAt: at(9) }),
      row({ status: "ENDED", startedAt: at(9), endedAt: at(4) }),
      row({ status: "MISSED" }),
      row({ status: "DECLINED" }),
      row({ kind: "VIDEO", status: "ENDED", startedAt: at(30), endedAt: at(1) }),
      row({ callerId: "them", status: "MISSED" }),
    ];

    for (const source of cases) {
      for (const viewerId of ["me", "them"]) {
        expect(toEntry(source, viewerId)).toEqual(throughThread(source, viewerId));
      }
    }
  });
});
