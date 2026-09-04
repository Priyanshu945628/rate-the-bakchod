import "server-only";

/**
 * Direct messages.
 *
 * A conversation is exactly two people. `Conversation.pairKey` is the two member
 * ids sorted and joined, and it is unique — so however many times either side taps
 * "Message" there is one thread. No duplicate-thread bug to find later, and no
 * join through `members` just to ask whether a thread already exists.
 *
 * Membership is the authorisation story, and it is checked in the `where` of every
 * query rather than in an `if` beforehand. A non-member's request finds no rows
 * instead of finding rows and then being refused; the second shape leaks the
 * existence of a conversation through the difference between 403 and 404.
 *
 * Attachments deliberately do **not** go through `enqueueArchiveUpload`. Post media
 * goes to the Internet Archive, which is public, permanent and has no delete —
 * exactly right for evidence and exactly wrong for a private message. DM images
 * follow the `ProfileAsset` path instead: the same EXIF-stripping sharp chain,
 * bytes in Postgres, served behind a membership check, and really destroyed when
 * the message is deleted.
 */

import { Prisma, type User } from "@prisma/client";
import { limits } from "./config";
import { normalizeProfileImage } from "./media/profile-image";
import { newStorageKey, toBytes } from "./media/store";
import { notify, unreadCount } from "./notifications";
import { prisma } from "./prisma";
import { PostServiceError, resolveAvatarUrl } from "./posts";
import { publish, publishTo } from "./realtime";
import type {
  ClientConversation,
  ClientConversationList,
  ClientCounterpart,
  ClientMessage,
  ClientReplyRef,
  ClientThread,
  ClientThreadEntry,
} from "./types";

/** How many entries an open thread loads at a time. */
export const THREAD_PAGE_SIZE = 40;

/**
 * Ceiling on the conversation list. Threads are two-person, so this is a hundred
 * different people — far past the point where the list needs a search box rather
 * than a longer page.
 */
const CONVERSATION_LIMIT = 100;

/** Longest preview the list will render before it truncates. */
const PREVIEW_CHARS = 90;

const counterpartSelect = {
  id: true,
  handle: true,
  displayName: true,
  avatarUrl: true,
  isAI: true,
  lastSeenAt: true,
  theme: { select: { logoKey: true } },
} satisfies Prisma.UserSelect;

type CounterpartRow = Prisma.UserGetPayload<{ select: typeof counterpartSelect }>;

function toCounterpart(row: CounterpartRow): ClientCounterpart {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
    isAI: row.isAI,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * The unique key for a pair of people, in a canonical order.
 *
 * Sorted, so `pairKey(a, b) === pairKey(b, a)` and the unique index does the
 * de-duplication instead of application code. Two people opening a thread with each
 * other in the same instant race to `create`; the loser catches P2002 and reads the
 * winner's row.
 */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

// ---------------------------------------------------------------------------
// Who may message whom
// ---------------------------------------------------------------------------

/**
 * Whether `senderId` may put a message in front of `recipientId`.
 *
 * `FOLLOWERS` means the sender has to follow the recipient. That is a speed bump
 * rather than a wall — following is public and free — but it is what the setting
 * says, and it does stop an account that has never so much as looked at you.
 *
 * Checked when a thread is opened, on every send, and before a call rings. A policy
 * that only applied to strangers would be no use to the person who turned it on: the
 * messages they want to stop are usually in a thread that already exists.
 */
export async function mayMessage(senderId: string, recipientId: string): Promise<boolean> {
  const theme = await prisma.profileTheme.findUnique({
    where: { userId: recipientId },
    select: { dmPolicy: true },
  });
  const policy = theme?.dmPolicy ?? "EVERYONE";
  if (policy === "EVERYONE") return true;
  if (policy === "NOBODY") return false;

  const edge = await prisma.follow.findUnique({
    where: {
      followerId_followeeId: { followerId: senderId, followeeId: recipientId },
    },
    select: { followerId: true },
  });
  return edge !== null;
}

/** Whether this person is in this thread. The guard every call route shares. */
export async function isMember(userId: string, conversationId: string): Promise<boolean> {
  const row = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

/**
 * The other member's id, or null if the thread is gone or this person is not in
 * it. Both answers are the same null on purpose — see the module note.
 */
export async function counterpartId(
  userId: string,
  conversationId: string,
): Promise<string | null> {
  if (!(await isMember(userId, conversationId))) return null;
  const other = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  return other?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Opening a thread
// ---------------------------------------------------------------------------

/**
 * Find or create the thread between the viewer and one handle.
 *
 * Idempotent, which is what makes "Message" a link rather than a form: tapping it
 * five times returns the same conversation id five times.
 */
export async function openConversation(
  viewer: User,
  handle: string,
): Promise<{ id: string; counterpart: ClientCounterpart }> {
  const target = await prisma.user.findUnique({
    where: { handle },
    select: counterpartSelect,
  });
  if (!target) throw new PostServiceError("No such person.", 404);
  if (target.id === viewer.id) {
    throw new PostServiceError("You cannot message yourself.", 400);
  }
  // The house account has no inbox and no bell — it reads the feed on its own
  // schedule. A thread with it would be messages nobody ever opens.
  if (target.isAI) {
    throw new PostServiceError("The house account does not take messages.", 400);
  }
  if (!(await mayMessage(viewer.id, target.id))) {
    throw new PostServiceError("They are not accepting messages.", 403);
  }

  const key = pairKey(viewer.id, target.id);
  const existing = await prisma.conversation.findUnique({
    where: { pairKey: key },
    select: { id: true },
  });
  if (existing) return { id: existing.id, counterpart: toCounterpart(target) };

  try {
    const created = await prisma.conversation.create({
      data: {
        pairKey: key,
        members: { create: [{ userId: viewer.id }, { userId: target.id }] },
      },
      select: { id: true },
    });
    return { id: created.id, counterpart: toCounterpart(target) };
  } catch (err) {
    // P2002 on `pairKey`: the other side opened the same thread a millisecond ago.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.conversation.findUniqueOrThrow({
        where: { pairKey: key },
        select: { id: true },
      });
      return { id: row.id, counterpart: toCounterpart(target) };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The conversation list
// ---------------------------------------------------------------------------

export type LastRow = {
  body: string | null;
  attachmentKey: string | null;
  deletedAt: Date | null;
} | null;

/**
 * The one line the list shows under a name.
 *
 * Flattened here rather than in the browser: a deleted message must not send its
 * body to the client just so the client can decide not to draw it.
 */
export function previewOf(last: LastRow): string {
  if (!last) return "No messages yet";
  if (last.deletedAt) return "Message deleted";
  if (last.body) {
    return last.body.length > PREVIEW_CHARS
      ? `${last.body.slice(0, PREVIEW_CHARS)}…`
      : last.body;
  }
  if (last.attachmentKey) return "Photo";
  return "";
}

/**
 * Every thread the viewer is in, newest activity first.
 *
 * One query. The counterpart comes back through `members` with the viewer filtered
 * out in the `where`, so a two-person thread yields exactly one row and there is no
 * "which one of these is not me" step.
 */
export async function fetchConversations(userId: string): Promise<ClientConversationList> {
  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: CONVERSATION_LIMIT,
    select: {
      lastReadAt: true,
      conversation: {
        select: {
          id: true,
          lastMessageAt: true,
          members: {
            where: { userId: { not: userId } },
            select: { user: { select: counterpartSelect } },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              body: true,
              attachmentKey: true,
              deletedAt: true,
              createdAt: true,
              senderId: true,
            },
          },
        },
      },
    },
  });

  const conversations: ClientConversation[] = [];
  let unreadConversations = 0;

  for (const row of rows) {
    // The other member deleted their account. Nothing to show and nobody to
    // reply to, so the row is dropped rather than drawn as a blank name.
    const other = row.conversation.members[0]?.user;
    if (!other) continue;

    const last = row.conversation.messages[0] ?? null;
    const unread = isUnread(last, row.lastReadAt, userId);
    if (unread) unreadConversations += 1;

    conversations.push({
      id: row.conversation.id,
      counterpart: toCounterpart(other),
      preview: previewOf(last),
      lastMessageAt: row.conversation.lastMessageAt.toISOString(),
      unread,
    });
  }

  return { conversations, unreadConversations };
}

/**
 * Unread means: the newest message is theirs, and it landed after the last time
 * this member opened the thread. Your own message never marks your own thread
 * unread, and a thread you have never opened with nothing in it is not unread
 * either.
 */
export function isUnread(
  last: { senderId: string; createdAt: Date } | null,
  lastReadAt: Date | null,
  userId: string,
): boolean {
  if (!last || last.senderId === userId) return false;
  return !lastReadAt || last.createdAt > lastReadAt;
}

/**
 * How many threads have something the viewer has not read — the number behind the
 * dot on the rail.
 *
 * A loop over one query rather than an aggregate, because the condition compares a
 * message's timestamp against a column on the *membership* row and no `where`
 * clause can express that. Bounded by the same ceiling as the list, so it stays a
 * single round trip.
 */
export async function unreadConversationCount(userId: string): Promise<number> {
  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: CONVERSATION_LIMIT,
    select: {
      lastReadAt: true,
      conversation: {
        select: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { senderId: true, createdAt: true },
          },
        },
      },
    },
  });

  let count = 0;
  for (const row of rows) {
    if (isUnread(row.conversation.messages[0] ?? null, row.lastReadAt, userId)) {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// One open thread
// ---------------------------------------------------------------------------

const messageSelect = {
  id: true,
  senderId: true,
  body: true,
  attachmentKey: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  replyToId: true,
  // One level deep, deliberately. A reply to a reply quotes only its immediate
  // parent, so nesting further would fetch a chain nothing renders.
  replyTo: {
    select: {
      id: true,
      senderId: true,
      body: true,
      attachmentKey: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

const callSelect = {
  id: true,
  kind: true,
  status: true,
  callerId: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} satisfies Prisma.CallSelect;

type CallRow = Prisma.CallGetPayload<{ select: typeof callSelect }>;

/** The URL a DM image is served from. Behind a membership check, never public. */
function attachmentUrl(key: string): string {
  return `/api/message-asset/${key}`;
}

/** How much of a quoted message the reply strip carries. One line's worth. */
const REPLY_EXCERPT_CHARS = 120;

/**
 * The quoted line above a reply.
 *
 * A quote of a message that has since been unsent says so and carries nothing —
 * otherwise a reply would be a way to keep a copy of something the sender
 * deleted, which is the whole point of the delete.
 *
 * Newlines are flattened: this renders on one clamped line, and a quote of a
 * twelve-line message should not push the bubble it belongs to off the screen.
 */
function toReplyRef(row: MessageRow["replyTo"]): ClientReplyRef | null {
  if (!row) return null;
  const deleted = row.deletedAt !== null;
  const flat = (row.body ?? "").replace(/\s+/g, " ").trim();
  return {
    id: row.id,
    senderId: row.senderId,
    excerpt: deleted
      ? null
      : flat
        ? flat.length > REPLY_EXCERPT_CHARS
          ? `${flat.slice(0, REPLY_EXCERPT_CHARS)}…`
          : flat
        : null,
    hasImage: !deleted && row.attachmentKey !== null,
    deleted,
  };
}

/**
 * A message as one side of the thread sees it.
 *
 * A deleted message is stripped *here*, on the server, not hidden in the client.
 * A tombstone that still carries the original text in the RSC payload has not
 * deleted anything.
 */
function toClientMessage(row: MessageRow, userId: string): ClientMessage {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    body: deleted ? null : row.body,
    imageUrl: deleted || !row.attachmentKey ? null : attachmentUrl(row.attachmentKey),
    createdAt: row.createdAt.toISOString(),
    editedAt: deleted ? null : (row.editedAt?.toISOString() ?? null),
    deleted,
    mine: row.senderId === userId,
    senderId: row.senderId,
    // Kept on a deleted message: the reply is still an answer to something, and
    // dropping the quote would leave a tombstone that reads as unprompted.
    replyTo: toReplyRef(row.replyTo),
  };
}

/**
 * Read one thread, oldest entry first.
 *
 * Calls and messages live in separate tables, so the timeline is two queries
 * merged on `createdAt`. The cursor is a timestamp rather than a row id for the
 * same reason — an id cursor only works within one table, and half a timeline
 * paged against the wrong table is worse than a coarser cursor.
 *
 * Returns null for a thread the viewer is not in, or that no longer has another
 * member. The route turns both into a 404.
 */
export async function fetchThread(
  userId: string,
  conversationId: string,
  cursor?: string | null,
): Promise<ClientThread | null> {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: {
      conversation: {
        select: {
          id: true,
          members: {
            where: { userId: { not: userId } },
            select: { lastReadAt: true, user: { select: counterpartSelect } },
          },
        },
      },
    },
  });
  if (!member) return null;

  const other = member.conversation.members[0];
  if (!other) return null;

  const before = cursor ? new Date(cursor) : null;
  // `lte` rather than `lt`. Two rows can share a millisecond, and a strict bound
  // drops whichever of them fell the far side of the page boundary — permanently,
  // because no later page asks for that instant again. An inclusive bound re-sends
  // the boundary row instead, and both readers of this page already skip entries
  // whose id they are holding.
  const olderThan = before && !Number.isNaN(before.getTime()) ? { lte: before } : undefined;

  // Both halves fetched newest-first and then reversed. Paging backwards through a
  // thread is the natural direction to *load* it; forwards is the direction to
  // read it.
  const [messages, calls] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_PAGE_SIZE + 1,
      select: messageSelect,
    }),
    prisma.call.findMany({
      where: { conversationId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_PAGE_SIZE,
      select: callSelect,
    }),
  ]);

  const { entries, hasMore } = buildThreadPage(messages, calls, userId);

  return {
    id: member.conversation.id,
    counterpart: toCounterpart(other.user),
    entries,
    prevCursor: hasMore && entries.length > 0 ? entries[0]!.createdAt : null,
    theirLastReadAt: other.lastReadAt?.toISOString() ?? null,
    // Re-asked on every load: a thread can go read-only between two visits.
    canSend: await mayMessage(userId, other.user.id),
  };
}

/**
 * One page of a thread, from the two halves the database returned.
 *
 * Split out from `fetchThread` because it is the part with arithmetic in it and the
 * part a database cannot help with. Both queries come back newest-first; what leaves
 * here is oldest-first, the order a thread is read in.
 *
 * The `floor` rule is the subtle one. A call older than the oldest message on this
 * page belongs to the next page — kept here, it would be sorted above messages that
 * happened after it, which is not a page boundary so much as a lie about the order
 * things occurred in.
 */
export function buildThreadPage(
  messages: MessageRow[],
  calls: CallRow[],
  userId: string,
): { entries: ClientThreadEntry[]; hasMore: boolean } {
  // The extra message is the probe for "is there more", and is not rendered. A
  // thread of nothing but calls has no probe to read, so the call count stands in:
  // two people who only ever ring each other still get an Older button.
  const full = messages.length > THREAD_PAGE_SIZE;
  const page = full ? messages.slice(0, THREAD_PAGE_SIZE) : messages;
  const hasMore = full || (page.length === 0 && calls.length >= THREAD_PAGE_SIZE);

  const floor = page.length > 0 ? page[page.length - 1]!.createdAt : null;
  const callsOnPage = floor ? calls.filter((c) => c.createdAt >= floor) : calls;

  const entries: ClientThreadEntry[] = [
    ...page.map((row) => ({ entry: "message" as const, ...toClientMessage(row, userId) })),
    ...callsOnPage.map((row) => ({
      entry: "call" as const,
      id: row.id,
      kind: row.kind,
      status: row.status,
      direction: row.callerId === userId ? ("out" as const) : ("in" as const),
      // Only an answered call has a length. RINGING, MISSED and DECLINED have a
      // time but no duration, and rendering "0:00" for them reads as a bug.
      durationMs:
        row.startedAt && row.endedAt ? row.endedAt.getTime() - row.startedAt.getTime() : null,
      createdAt: row.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { entries, hasMore };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendInput {
  conversationId: string;
  body?: string | null;
  /** A key from `putMessageImage`, uploaded separately and attached here. */
  attachmentKey?: string | null;
  /** The message being replied to. Must be in this same conversation. */
  replyToId?: string | null;
}

/**
 * Put one message in a thread.
 *
 * The order is deliberate: membership, then policy, then attachment ownership, then
 * the reply target, then the write. Every one of those is a `where` against the
 * sender's own id or their own conversation, so there is no point at which a row is
 * fetched and *then* refused.
 */
export async function sendMessage(sender: User, input: SendInput): Promise<ClientMessage> {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const attachmentKey = input.attachmentKey ?? null;

  if (!body && !attachmentKey) throw new PostServiceError("Nothing to send.", 400);
  if (body.length > limits.messageMaxLength) {
    throw new PostServiceError(`Messages max ${limits.messageMaxLength} characters.`, 400);
  }

  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: input.conversationId, userId: sender.id } },
    select: {
      conversation: {
        select: {
          members: { where: { userId: { not: sender.id } }, select: { userId: true } },
        },
      },
    },
  });
  if (!member) throw new PostServiceError("That conversation is gone.", 404);

  const recipientId = member.conversation.members[0]?.userId;
  if (!recipientId) throw new PostServiceError("They are no longer here.", 410);

  if (!(await mayMessage(sender.id, recipientId))) {
    throw new PostServiceError("They are not accepting messages.", 403);
  }

  if (attachmentKey) await claimAttachment(sender.id, attachmentKey);

  // The `conversationId` in this `where` is the whole security of the feature. A
  // reply id is a client-supplied row id, and without it a crafted request would
  // quote any message in the database — including one from a thread the sender was
  // never in — straight into a bubble the recipient can read.
  const replyToId = input.replyToId ?? null;
  if (replyToId) {
    const parent = await prisma.message.findFirst({
      where: { id: replyToId, conversationId: input.conversationId },
      select: { id: true },
    });
    if (!parent) throw new PostServiceError("That message is not in this thread.", 400);
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: sender.id,
        body: body || null,
        attachmentKey,
        replyToId,
      },
      select: messageSelect,
    }),
    // The list orders on this column, so it moves in the same transaction as the
    // insert. A thread whose newest message does not float to the top of the list
    // looks exactly like a message that was never delivered.
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  await fanOutMessage(sender, recipientId, input.conversationId, message);
  return toClientMessage(message, sender.id);
}

/**
 * Ownership and single-use for an uploaded image.
 *
 * Both checks matter. Without the first, a key guessed or copied from someone
 * else's thread would send *their* image under your name. Without the second, one
 * upload could be attached to a message in every thread you are in, and deleting
 * any one of them would blank the rest.
 */
async function claimAttachment(ownerId: string, key: string): Promise<void> {
  const asset = await prisma.messageAttachment.findFirst({
    where: { key, ownerId },
    select: { key: true },
  });
  if (!asset) throw new PostServiceError("That image is not yours.", 400);

  const taken = await prisma.message.findUnique({
    where: { attachmentKey: key },
    select: { id: true },
  });
  if (taken) throw new PostServiceError("That image has already been sent.", 400);
}

/**
 * Push the new message to both ends, then leave a row in the recipient's bell.
 *
 * Two `publish` calls rather than one `publishTo`, because `unreadConversations` is
 * a different number for each side and a shared payload would put the recipient's
 * badge count on the sender's rail.
 *
 * The sender's own tabs get the message too. A thread open on a phone and a laptop
 * at once is the common case, not the exotic one.
 */
async function fanOutMessage(
  sender: User,
  recipientId: string,
  conversationId: string,
  message: MessageRow,
): Promise<void> {
  const wire = {
    type: "message" as const,
    conversationId,
    message: {
      id: message.id,
      body: message.body,
      imageUrl: message.attachmentKey ? attachmentUrl(message.attachmentKey) : null,
      createdAt: message.createdAt.toISOString(),
      replyTo: toReplyRef(message.replyTo),
      author: { id: sender.id, handle: sender.handle, displayName: sender.displayName },
    },
  };

  const [mine, theirs] = await Promise.all([
    unreadConversationCount(sender.id),
    unreadConversationCount(recipientId),
  ]);
  publish(sender.id, { ...wire, unreadConversations: mine });
  publish(recipientId, { ...wire, unreadConversations: theirs });

  // Collapsed on `conversationId` by `COLLAPSE_ON`, so twenty messages in a row
  // are one bell row rather than twenty. Reading the thread clears it — see
  // `markThreadRead`.
  await notify({
    userId: recipientId,
    actorId: sender.id,
    type: "MESSAGE",
    conversationId,
  });
}

// ---------------------------------------------------------------------------
// Read receipts and typing
// ---------------------------------------------------------------------------

/**
 * Mark a thread read, and clear what it left in the bell.
 *
 * Opening the thread *is* reading the notification. Leaving the MESSAGE row unread
 * after you have read the message it points at gives you a badge that only a
 * separate trip to the bell can clear, which is a counter people learn to ignore.
 *
 * Returns both fresh counts so the calling route can answer with them, and pushes
 * the same pair down the stream so the viewer's other tabs correct themselves.
 */
export async function markThreadRead(
  userId: string,
  conversationId: string,
): Promise<{ conversations: number; notifications: number }> {
  const now = new Date();
  const { count } = await prisma.conversationMember.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: now },
  });
  if (count === 0) throw new PostServiceError("That conversation is gone.", 404);

  await prisma.notification.updateMany({
    where: {
      userId,
      conversationId,
      readAt: null,
      type: { in: ["MESSAGE", "CALL_MISSED"] },
    },
    data: { readAt: now },
  });

  const [conversations, notifications, others] = await Promise.all([
    unreadConversationCount(userId),
    unreadCount(userId),
    prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    }),
  ]);

  publish(userId, { type: "unread", conversations, notifications });
  // The tick goes to the other side only. The reader already knows they read it.
  publishTo(
    others.map((m) => m.userId),
    { type: "read", conversationId, by: userId, at: now.toISOString() },
  );

  return { conversations, notifications };
}

/**
 * Tell the other side someone is typing.
 *
 * Never stored and never notified: it is gone the instant it is delivered, which is
 * the only honest way to draw it. A typing indicator that survives a reload is
 * showing you something that stopped being true minutes ago.
 *
 * Silent when the caller is not a member — there is nothing to tell them, and an
 * error here would be a way to probe which conversation ids exist.
 */
export async function notifyTyping(userId: string, conversationId: string): Promise<void> {
  if (!(await isMember(userId, conversationId))) return;
  const others = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  publishTo(
    others.map((m) => m.userId),
    { type: "typing", conversationId, by: userId },
  );
}

// ---------------------------------------------------------------------------
// Editing and deleting
// ---------------------------------------------------------------------------

/**
 * Tell both ends that one message is not what it was.
 *
 * One event covers a rewrite and an unsend, because from the thread's point of
 * view they are the same thing: an entry it already has, changed. The strip on a
 * delete happens here — the payload leaves with `body: null`, so a tombstone never
 * travels with the text it is replacing.
 *
 * Addressed to every member, which includes the sender: their own other tabs are
 * showing the old words too.
 */
async function fanOutUpdate(
  conversationId: string,
  memberIds: string[],
  update: { messageId: string; body: string | null; editedAt: Date | null; deleted: boolean },
): Promise<void> {
  publishTo(memberIds, {
    type: "message-update",
    conversationId,
    messageId: update.messageId,
    body: update.deleted ? null : update.body,
    editedAt: update.editedAt?.toISOString() ?? null,
    deleted: update.deleted,
  });
}

/**
 * Rewrite your own message.
 *
 * Only the words, and only a message that had words to begin with: `body: { not:
 * null }` in the `where` keeps this off image-only messages, where "edit" would
 * mean captioning a photo after the recipient had already seen it bare.
 *
 * `editedAt` is set on every edit and the bubble shows it. There is no silent
 * version of this — an edit nobody can see having happened is a way to put
 * different words in your own mouth after they have been read and answered.
 */
export async function editMessage(
  user: User,
  messageId: string,
  nextBody: string,
): Promise<ClientMessage> {
  const body = nextBody.trim();
  if (!body) throw new PostServiceError("An edit cannot be empty.", 400);
  if (body.length > limits.messageMaxLength) {
    throw new PostServiceError(`Messages max ${limits.messageMaxLength} characters.`, 400);
  }

  const existing = await prisma.message.findFirst({
    where: { id: messageId, senderId: user.id, deletedAt: null, body: { not: null } },
    select: {
      id: true,
      conversationId: true,
      conversation: { select: { members: { select: { userId: true } } } },
    },
  });
  // Not-yours, not-there and nothing-to-edit are one 404. Which of the three it
  // was is not the sender's business.
  if (!existing) throw new PostServiceError("That is not your message.", 404);

  const editedAt = new Date();
  const message = await prisma.message.update({
    where: { id: existing.id },
    data: { body, editedAt },
    select: messageSelect,
  });

  await fanOutUpdate(
    existing.conversationId,
    existing.conversation.members.map((m) => m.userId),
    { messageId: message.id, body, editedAt, deleted: false },
  );

  return toClientMessage(message, user.id);
}

/**
 * Delete your own message.
 *
 * The row stays and the timestamp stays, so the thread does not silently reshuffle
 * around a hole; what goes is the content. `body` is nulled and the attachment row
 * is really deleted, in one transaction — which is the whole reason DM images never
 * went to the archive, where there is no delete at all.
 */
export async function deleteMessage(user: User, messageId: string): Promise<void> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, senderId: user.id, deletedAt: null },
    select: {
      id: true,
      conversationId: true,
      attachmentKey: true,
      conversation: { select: { members: { select: { userId: true } } } },
    },
  });
  // Not-yours and not-there are the same 404. Which of the two it was is not the
  // sender's business.
  if (!message) throw new PostServiceError("That is not your message.", 404);

  await prisma.$transaction([
    prisma.message.update({
      where: { id: message.id },
      data: { deletedAt: new Date(), body: null, attachmentKey: null },
    }),
    ...(message.attachmentKey
      ? [
          prisma.messageAttachment.deleteMany({
            where: { key: message.attachmentKey, ownerId: user.id },
          }),
        ]
      : []),
  ]);

  // After the write, not before: an unsend that lit up the other end and then
  // failed to commit would be a message that reads as deleted and is not.
  await fanOutUpdate(
    message.conversationId,
    message.conversation.members.map((m) => m.userId),
    { messageId: message.id, body: null, editedAt: null, deleted: true },
  );
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface StoredMessageImage {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Normalise and store a DM image, unattached.
 *
 * Two steps rather than one multipart send, so the compose box can show a preview
 * and a failed upload costs nothing — the row sits there owned by the uploader
 * until a `sendMessage` claims it.
 *
 * The pipeline is `normalizeProfileImage`: same sharp chain, same `.rotate()` before
 * resize, same EXIF strip, same quality ladder. The caps come from the DM half of
 * `lib/config.ts` rather than the profile half — numerically identical today, but a
 * limit that is defined and never enforced stops meaning anything the moment one of
 * the two numbers moves.
 */
export async function putMessageImage(
  user: User,
  file: Buffer,
): Promise<StoredMessageImage> {
  const image = await normalizeProfileImage(file, limits.dmImageMaxEdge, {
    uploadMaxBytes: limits.dmImageUploadMaxBytes,
    maxBytes: limits.dmImageMaxBytes,
  });
  const key = newStorageKey();

  await prisma.messageAttachment.create({
    data: {
      key,
      ownerId: user.id,
      mimeType: image.mimeType,
      data: toBytes(image.data),
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    },
  });

  return {
    key,
    url: attachmentUrl(key),
    width: image.width,
    height: image.height,
    bytes: image.bytes,
  };
}

/**
 * The bytes behind a DM image, for someone entitled to see them.
 *
 * The membership check is the entire reason this route exists instead of a public
 * one: these are private pictures, and an unguessable key is not an authorisation
 * model — it is a URL, and URLs get pasted into group chats and crawled out of
 * history.
 *
 * The owner can always read their own, which is what makes the compose preview work
 * before the message exists.
 */
export async function readMessageAttachment(key: string, viewerId: string) {
  const asset = await prisma.messageAttachment.findUnique({
    where: { key },
    select: { mimeType: true, data: true, bytes: true, ownerId: true },
  });
  if (!asset) return null;
  if (asset.ownerId === viewerId) return asset;

  const message = await prisma.message.findUnique({
    where: { attachmentKey: key },
    select: { conversationId: true },
  });
  if (!message) return null;

  return (await isMember(viewerId, message.conversationId)) ? asset : null;
}
