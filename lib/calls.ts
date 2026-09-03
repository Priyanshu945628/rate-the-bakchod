import "server-only";

import type { User } from "@prisma/client";
import { limits } from "./config";
import { counterpartId, mayMessage } from "./messages";
import { notify } from "./notifications";
import { PostServiceError, resolveAvatarUrl } from "./posts";
import { prisma } from "./prisma";
import { publish } from "./realtime";
import type {
  CallKindName,
  CallPhase,
  ClientCallEntry,
  ClientCallPeer,
  RealtimeEvent,
} from "./types";

/**
 * Voice and video calls.
 *
 * The media never touches this server. Two browsers negotiate a peer connection and
 * then talk directly; all that travels through here is the invitation, the answer,
 * and the SDP and ICE payloads they need to find each other. Those payloads are
 * relayed and never written down — they contain both participants' network addresses,
 * which is exactly the sort of thing a database keeps long after anyone needs it.
 *
 * What *is* stored is the fact of the call: who rang whom, when, and how it ended.
 * That is a line in the conversation, and a call log people can see is the honest
 * version of a feature that could otherwise ring someone from nowhere.
 *
 * One live call per person, enforced here rather than in the UI. Without it, two
 * invitations can arrive at once and there is no correct thing for a client with one
 * `RTCPeerConnection` to do with the second.
 *
 * A ringing row is swept to MISSED once it is older than `limits.ringTimeoutMs`. The
 * caller's own tab normally ends the call it gave up on, but a tab that is closed
 * mid-ring cannot, and a row left RINGING forever would lock both people out of
 * calling each other again.
 */

const participantSelect = {
  id: true,
  handle: true,
  displayName: true,
  avatarUrl: true,
  theme: { select: { logoKey: true } },
} as const;

/** RINGING and ACCEPTED are the two states that own a person's line. */
const LIVE: ("RINGING" | "ACCEPTED")[] = ["RINGING", "ACCEPTED"];

/**
 * The other end of a call. The client-facing shape, unchanged — a call panel wants
 * exactly what a signalling frame carries, so there is nothing here to translate.
 */
export type CallPeer = ClientCallPeer;

/** What a caller's own browser needs back to draw the ringing panel. */
export interface StartedCall {
  callId: string;
  kind: CallKindName;
  conversationId: string;
  peer: CallPeer;
}

const callSelect = {
  id: true,
  conversationId: true,
  callerId: true,
  calleeId: true,
  kind: true,
  status: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const;

/**
 * What it takes to describe a call in a timeline: which call it was, who rang, and
 * the two stamps that make a duration. Narrower than `CallRow` on purpose — it is
 * exactly the set of columns `toEntry` reads, which is what lets a test compare it
 * against `buildThreadPage` without inventing a conversation.
 */
export interface CallEntrySource {
  id: string;
  callerId: string;
  kind: CallKindName;
  status: ClientCallEntry["status"];
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

/**
 * A stored call. Spelled out rather than inferred from Prisma so that the shape the
 * helpers below take is readable in one place.
 */
interface CallRow extends CallEntrySource {
  conversationId: string;
  calleeId: string;
}

type ParticipantRow = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  theme: { logoKey: string | null } | null;
};

function toPeer(row: ParticipantRow): CallPeer {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
  };
}

/**
 * How the call reads in the timeline, from the side of whoever is reading.
 *
 * The same arithmetic as the call branch of `buildThreadPage`, written out twice
 * rather than shared: that module is this one's dependency, so the borrowing can
 * only go one way. Exported so a test can hold the two against each other — a call
 * that appends over the stream and the same call after a reload have to agree, and
 * duplicated arithmetic is the kind that drifts silently.
 */
export function toEntry(row: CallEntrySource, viewerId: string): ClientCallEntry {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    direction: row.callerId === viewerId ? "out" : "in",
    durationMs:
      row.startedAt && row.endedAt ? row.endedAt.getTime() - row.startedAt.getTime() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

type CallEvent = Extract<RealtimeEvent, { type: "call" }>;

/** Every frame carries the same four identifiers; only the tail differs. */
function frame(
  row: CallRow,
  phase: CallPhase,
  from: CallPeer,
  tail: Pick<CallEvent, "signal" | "entry"> = {},
): CallEvent {
  return {
    type: "call",
    callId: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    phase,
    from,
    ...tail,
  };
}

/** Both participants, avatars resolved, in one query. */
async function participants(row: CallRow): Promise<ParticipantRow[]> {
  return prisma.user.findMany({
    where: { id: { in: [row.callerId, row.calleeId] } },
    select: participantSelect,
  });
}

/**
 * Close a call and tell both sides.
 *
 * The status guard is what makes this safe to reach twice. A caller giving up and the
 * sweep noticing the same abandoned row are the same event arriving from two
 * directions, and only the write that actually lands should produce a bell row.
 *
 * `actorId` is whoever caused it — the person who hung up, or the caller when a ring
 * simply ran out. It becomes the frame's `from`, which is how a client with a panel
 * open knows whose face to take down.
 */
async function finish(
  row: CallRow,
  status: "DECLINED" | "MISSED" | "ENDED",
  phase: "decline" | "end",
  actorId: string,
): Promise<void> {
  const endedAt = new Date();
  const { count } = await prisma.call.updateMany({
    where: { id: row.id, status: { in: LIVE } },
    data: { status, endedAt },
  });
  if (count === 0) return;

  const closed: CallRow = { ...row, status, endedAt };
  const people = await participants(row);
  const actor = people.find((p) => p.id === actorId);
  if (actor) {
    const from = toPeer(actor);
    // Both sides, each with its own entry: the same call is "out" on one screen and
    // "in" on the other, so the row cannot be shared.
    for (const person of people) {
      publish(person.id, frame(closed, phase, from, { entry: toEntry(closed, person.id) }));
    }
  }

  if (status === "MISSED") {
    await notify({
      userId: row.calleeId,
      actorId: row.callerId,
      type: "CALL_MISSED",
      conversationId: row.conversationId,
    });
  }
}

/**
 * Retire ringing rows that nobody is waiting on any more.
 *
 * Run before deciding whether a line is busy, and scoped to the two people about to
 * be involved rather than the whole table — this is housekeeping done on the way
 * past, not a job.
 */
async function sweepStale(userIds: string[]): Promise<void> {
  const stale = await prisma.call.findMany({
    where: {
      status: "RINGING",
      createdAt: { lt: new Date(Date.now() - limits.ringTimeoutMs) },
      OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }],
    },
    select: callSelect,
  });
  for (const row of stale) {
    // The caller is the actor: their call is the one that went unanswered, and it is
    // their face on the panel the callee may still have open.
    await finish(row, "MISSED", "end", row.callerId);
  }
}

// ---------------------------------------------------------------------------
// Ringing
// ---------------------------------------------------------------------------

/**
 * Ring the other member of a conversation.
 *
 * The same policy that governs a message governs a call, deliberately: a ring is a
 * louder message, and someone who has closed their inbox has not asked for a phone
 * instead. Only the callee is told — the caller already knows, and gets what it needs
 * to draw its own panel from the return value.
 *
 * No offer is created here. The caller's browser waits for `accept` before it touches
 * `RTCPeerConnection`, so a call nobody picks up gathers no candidates and reveals no
 * addresses.
 */
export async function startCall(
  caller: User,
  conversationId: string,
  kind: CallKindName,
): Promise<StartedCall> {
  const otherId = await counterpartId(caller.id, conversationId);
  // Not a member and no such thread are the same 404: which of the two it was is not
  // the asker's business.
  if (!otherId) throw new PostServiceError("No such conversation.", 404);

  const people = await prisma.user.findMany({
    where: { id: { in: [caller.id, otherId] } },
    select: { ...participantSelect, isAI: true },
  });
  const from = people.find((p) => p.id === caller.id);
  const callee = people.find((p) => p.id === otherId);
  if (!from || !callee) throw new PostServiceError("No such conversation.", 404);
  if (callee.isAI) {
    throw new PostServiceError("The house account does not take calls.", 400);
  }
  if (!(await mayMessage(caller.id, callee.id))) {
    throw new PostServiceError("They are not accepting calls.", 403);
  }

  await sweepStale([caller.id, callee.id]);

  const busy = await prisma.call.findFirst({
    where: {
      status: { in: LIVE },
      OR: [{ callerId: { in: [caller.id, callee.id] } }, { calleeId: { in: [caller.id, callee.id] } }],
    },
    select: { callerId: true, calleeId: true },
  });
  if (busy) {
    const mine = busy.callerId === caller.id || busy.calleeId === caller.id;
    throw new PostServiceError(
      mine ? "You are already on a call." : "They are on another call.",
      409,
    );
  }

  const row = await prisma.call.create({
    data: { conversationId, callerId: caller.id, calleeId: callee.id, kind },
    select: callSelect,
  });

  publish(callee.id, frame(row, "invite", toPeer(from)));

  return { callId: row.id, kind, conversationId, peer: toPeer(callee) };
}

// ---------------------------------------------------------------------------
// Answering, refusing, hanging up
// ---------------------------------------------------------------------------

/** The call, if this person is one of its two participants. */
async function load(userId: string, callId: string): Promise<CallRow> {
  const row = await prisma.call.findFirst({
    where: { id: callId, OR: [{ callerId: userId }, { calleeId: userId }] },
    select: callSelect,
  });
  if (!row) throw new PostServiceError("No such call.", 404);
  return row;
}

/**
 * Pick up.
 *
 * `startedAt` is stamped here and not at invite time, so a call's duration is the
 * length of the conversation rather than the length of the wait for it.
 *
 * This is also the signal the caller has been waiting for: it creates its offer only
 * once someone is actually there to answer it.
 */
export async function acceptCall(user: User, callId: string): Promise<void> {
  const row = await load(user.id, callId);
  if (row.calleeId !== user.id) {
    throw new PostServiceError("That is not your call to answer.", 403);
  }

  const startedAt = new Date();
  const { count } = await prisma.call.updateMany({
    where: { id: row.id, status: "RINGING" },
    data: { status: "ACCEPTED", startedAt },
  });
  // Zero means it stopped ringing between the tap and this write — swept, or hung up
  // on from the other end.
  if (count === 0) throw new PostServiceError("That call is no longer ringing.", 409);

  const answered: CallRow = { ...row, status: "ACCEPTED", startedAt };
  const people = await participants(row);
  const actor = people.find((p) => p.id === user.id);
  if (actor) publish(row.callerId, frame(answered, "accept", toPeer(actor)));
}

/** Refuse a call that is still ringing. The callee's decision, and only theirs. */
export async function declineCall(user: User, callId: string): Promise<void> {
  const row = await load(user.id, callId);
  if (row.calleeId !== user.id) {
    throw new PostServiceError("That is not your call to decline.", 403);
  }
  await finish(row, "DECLINED", "decline", user.id);
}

/**
 * Hang up, from either side and at any point.
 *
 * A call that was never answered does not end; it either ran out or was refused, and
 * which of the two depends on who let go of it. The caller's own tab is what gives up
 * after `limits.ringTimeoutMs`, and that is the ordinary way a call becomes MISSED —
 * the server-side sweep only covers the tab that closed before it could.
 */
export async function endCall(user: User, callId: string): Promise<void> {
  const row = await load(user.id, callId);
  if (row.status === "RINGING") {
    const byCallee = row.calleeId === user.id;
    await finish(row, byCallee ? "DECLINED" : "MISSED", byCallee ? "decline" : "end", user.id);
    return;
  }
  await finish(row, "ENDED", "end", user.id);
}

// ---------------------------------------------------------------------------
// Signalling
// ---------------------------------------------------------------------------

/**
 * Hand one SDP or ICE payload to the other end, and forget it.
 *
 * Nothing here is stored. These payloads carry both participants' candidate addresses
 * — their local network, and whatever their ISP hands out — and a table of those would
 * outlive any use for them by years. The bus is in memory, which is the whole reason
 * this shape works: the frame exists for as long as it takes to reach a browser.
 *
 * Unmetered, unlike the invite. One answered call is dozens of candidates, so a budget
 * a normal call could exhaust is a budget that breaks calling.
 */
export async function relaySignal(user: User, callId: string, signal: unknown): Promise<void> {
  const row = await load(user.id, callId);
  if (row.status !== "RINGING" && row.status !== "ACCEPTED") {
    throw new PostServiceError("That call is over.", 409);
  }

  const to = row.callerId === user.id ? row.calleeId : row.callerId;
  // Built from the session rather than re-read, and with no picture claimed: a signal
  // frame's `from` is only ever matched by id, and a query per candidate would be
  // dozens of them per call.
  const peer: CallPeer = {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: null,
  };
  publish(to, frame(row, "signal", peer, { signal }));
}
