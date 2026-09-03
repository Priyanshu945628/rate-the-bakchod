import "server-only";

/**
 * Notifications.
 *
 * One place decides three things that must not drift apart: whether an event is
 * worth a row at all, what that row *says*, and where clicking it goes. The bell
 * dropdown renders `text` and `href` verbatim — it never assembles a sentence —
 * because the same row also travels down the realtime stream, and a client that
 * phrased its own copy would show one wording live and a different one after a
 * reload.
 *
 * Writes here are fire-and-forget by design. A notification is always a side
 * effect of something the user actually asked for — a rating, a follow, a comment
 * — and a failure to record the side effect must never fail the thing itself.
 * `notify` therefore swallows its own errors and callers use `void notify(...)`.
 */

import type { NotificationType, Prisma } from "@prisma/client";
import { resolveAvatarUrl } from "./avatar";
import { prisma } from "./prisma";
import { hasListener, publish } from "./realtime";
import type { ClientNotification, ClientNotificationPage } from "./types";

/** How many rows the bell asks for at a time. */
const PAGE_SIZE = 20;

/**
 * How many people one new account may be announced to.
 *
 * "Everyone gets told" is the product rule, and at this size everyone is everyone.
 * The cap is here so it stays a bounded write if the platform ever gets big: past
 * it, the announcement goes to the most recently active accounts, because a bell
 * nobody opens is not worth an unbounded INSERT.
 */
const JOIN_FANOUT_LIMIT = 5000;

/** Rows per INSERT in the fan-out. Postgres has a parameter ceiling per statement. */
const JOIN_FANOUT_CHUNK = 500;

/**
 * How long a repeat event folds into the row already sitting unread.
 *
 * Without a window, a post that gets rated for a year would keep bumping one row
 * from last January. Twelve hours is long enough that a burst of ratings on one
 * post is one line in the bell, and short enough that tomorrow's rating is news
 * again.
 */
const COLLAPSE_MS = 12 * 60 * 60 * 1000;

const actorSelect = {
  handle: true,
  displayName: true,
  avatarUrl: true,
  theme: { select: { logoKey: true } },
} satisfies Prisma.UserSelect;

const notificationSelect = {
  id: true,
  type: true,
  postId: true,
  commentId: true,
  conversationId: true,
  readAt: true,
  createdAt: true,
  actor: { select: actorSelect },
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/**
 * Which types fold a repeat into the row already there, and on what.
 *
 * Ratings and story views arrive in bursts from different people at the same
 * thing, and messages arrive in bursts from the *same* person — three shapes of
 * the same problem, which is that the bell should say "your post got rated", not
 * repeat it eleven times. The value is the column the burst shares.
 *
 * Follows, comments and mentions are each their own event and never collapse: two
 * people commenting are two things you want to read.
 */
export const COLLAPSE_ON: Partial<
  Record<NotificationType, "postId" | "conversationId">
> = {
  RATING: "postId",
  STORY_VIEW: "postId",
  MESSAGE: "conversationId",
};

/** The fields `describeNotification` reads. Narrow so tests can pass a literal. */
export interface DescribableNotification {
  type: NotificationType;
  postId: string | null;
  conversationId: string | null;
  actor: { displayName: string; handle: string } | null;
}

/**
 * The sentence and the destination.
 *
 * `selfHandle` is threaded through because one type is about the reader's own
 * things rather than the actor's: a story view goes to your own profile, where
 * your stories live. Everything else points at the actor or at a post.
 *
 * Exported for `test/notify-describe.test.ts` — the wording is the part of this
 * module a person will read, and a type that fell through to an empty string or a
 * dead `/p/null` link would look fine in every code review.
 */
export function describeNotification(
  row: DescribableNotification,
  selfHandle: string,
): { text: string; href: string | null } {
  const who = row.actor?.displayName ?? "Someone";
  const actorHref = row.actor ? `/u/${encodeURIComponent(row.actor.handle)}` : null;
  const postHref = row.postId ? `/p/${row.postId}` : null;
  const dmHref = row.conversationId ? `/messages/${row.conversationId}` : null;

  switch (row.type) {
    case "FOLLOW":
      return { text: `${who} started following you`, href: actorHref };
    case "RATING":
      return { text: `${who} rated your bakchodi`, href: postHref };
    case "COMMENT":
      return { text: `${who} commented on your post`, href: postHref };
    case "AI_COMMENT":
      return { text: `${who} had something to say about your post`, href: postHref };
    case "MENTION":
      return { text: `${who} mentioned you`, href: postHref };
    case "STORY_VIEW":
      return {
        text: `${who} watched your story`,
        href: `/u/${encodeURIComponent(selfHandle)}`,
      };
    case "MESSAGE":
      return { text: `${who} sent you a message`, href: dmHref };
    case "CALL_MISSED":
      return { text: `Missed call from ${who}`, href: dmHref };
    case "USER_JOINED":
      return { text: `${who} joined Rate the Bakchod`, href: actorHref };
    case "ADMIN_HIDE":
      // No actor: which moderator acted is not the reader's business, and naming
      // one turns a moderation decision into a personal one.
      return { text: "A moderator hid one of your posts", href: null };
    case "ADMIN_DELETE":
      // No link either. The post is gone everywhere except the author's own
      // profile, where the tombstone is — a `/p/<id>` here would 404.
      return { text: "A moderator deleted one of your posts", href: null };
  }
}

function toClient(row: NotificationRow, selfHandle: string): ClientNotification {
  const { text, href } = describeNotification(row, selfHandle);
  return {
    id: row.id,
    kind: row.type,
    text,
    href,
    actor: row.actor
      ? {
          handle: row.actor.handle,
          displayName: row.actor.displayName,
          avatarUrl: resolveAvatarUrl(row.actor),
        }
      : null,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NotifyInput {
  /** Who is being told. */
  userId: string;
  /** Who caused it. Null for system events — the two `ADMIN_*` types. */
  actorId?: string | null;
  type: NotificationType;
  postId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
}

/**
 * Record a notification and push it live. Never throws.
 *
 * Self-directed events are dropped: rating your own post, viewing your own story,
 * and commenting on your own post all reach this function, and none of them is
 * news. Doing it here rather than at each of six call sites is the difference
 * between one rule and six chances to forget it.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    if (input.actorId && input.actorId === input.userId) return;

    const row = await insert(input);
    if (!row) return;

    const recipient = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { handle: true },
    });
    if (!recipient) return;

    const unread = await unreadCount(input.userId);
    const client = toClient(row, recipient.handle);

    publish(input.userId, {
      type: "notification",
      unread,
      notification: {
        id: client.id,
        kind: row.type,
        text: client.text,
        href: client.href,
        actor: client.actor,
        createdAt: client.createdAt,
      },
    });
  } catch (err) {
    console.error("[notifications] failed to notify:", err);
  }
}

/**
 * Insert, or fold into an unread row of the same shape.
 *
 * `updateMany` then `create` rather than `upsert`: there is no unique constraint
 * to upsert against, and adding one would be wrong anyway — the collapse depends
 * on `readAt` being null and on the row being recent, neither of which a unique
 * index can express. The race this leaves open is two simultaneous ratings both
 * finding nothing to update and both inserting, which produces one duplicate line
 * in a bell. That is a better failure than a lost notification.
 */
async function insert(input: NotifyInput): Promise<NotificationRow | null> {
  const collapseKey = COLLAPSE_ON[input.type];
  const collapseValue = collapseKey ? (input[collapseKey] ?? null) : null;

  if (collapseKey && collapseValue) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        [collapseKey]: collapseValue,
        readAt: null,
        createdAt: { gte: new Date(Date.now() - COLLAPSE_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existing) {
      // The actor is replaced, not appended: the row now reads as the most recent
      // person, which is the one the reader is most likely to care about.
      return prisma.notification.update({
        where: { id: existing.id },
        data: {
          actorId: input.actorId ?? null,
          commentId: input.commentId ?? null,
          createdAt: new Date(),
        },
        select: notificationSelect,
      });
    }
  }

  return prisma.notification.create({
    data: {
      userId: input.userId,
      actorId: input.actorId ?? null,
      type: input.type,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      conversationId: input.conversationId ?? null,
    },
    select: notificationSelect,
  });
}

/**
 * Tell a post's author about something that happened to it.
 *
 * A thin wrapper over `notify`, but it saves every caller a `select` for the
 * author id — and more importantly it means no caller has to remember that the
 * post might have been deleted between the action and the notification.
 */
export async function notifyPostAuthor(
  postId: string,
  type: NotificationType,
  actorId: string | null,
  commentId?: string | null,
): Promise<void> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (!post) return;
    await notify({ userId: post.authorId, actorId, type, postId, commentId });
  } catch (err) {
    console.error("[notifications] failed to notify post author:", err);
  }
}

// ---------------------------------------------------------------------------
// The one broadcast
// ---------------------------------------------------------------------------

/**
 * Tell everybody that somebody joined.
 *
 * The only notification in the app that is not addressed to one person about one
 * thing they did, which is why it does not go through `notify`: that inserts a row,
 * counts unread, and publishes, per recipient. Doing that N times for one sign-up
 * would be 3N queries for an event nobody is waiting on.
 *
 * So the recipients are split. Anyone with an open stream goes through `notify`,
 * because they get the row *and* the live line in the bell and both have to agree.
 * Everyone else is one bulk INSERT per chunk — their bell is correct the next time
 * they load a page, which is the only time they will look at it.
 *
 * The AI is excluded. It has no bell and reads the feed on its own schedule.
 *
 * Called from `getCurrentUser` at the moment the row is created, and fire-and-forget
 * like every other notification: a failure here must never turn a first sign-in into
 * an error page.
 */
export async function announceJoin(joiner: { id: string }): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: { id: { not: joiner.id }, isAI: false },
      // Most recently seen first, so if the cap ever bites it keeps the people who
      // are actually here. Nulls (never opened a page) sort last.
      orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: JOIN_FANOUT_LIMIT,
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const live: string[] = [];
    const quiet: string[] = [];
    for (const { id } of recipients) (hasListener(id) ? live : quiet).push(id);

    for (let i = 0; i < quiet.length; i += JOIN_FANOUT_CHUNK) {
      await prisma.notification.createMany({
        data: quiet.slice(i, i + JOIN_FANOUT_CHUNK).map((userId) => ({
          userId,
          actorId: joiner.id,
          type: "USER_JOINED" as const,
        })),
      });
    }

    await Promise.all(
      live.map((userId) => notify({ userId, actorId: joiner.id, type: "USER_JOINED" })),
    );
  } catch (err) {
    console.error("[notifications] failed to announce a join:", err);
  }
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------
/**
 * `@handle` in a caption or a comment.
 *
 * The character class matches `HANDLE_RE` deliberately — an `@` followed by
 * anything a handle cannot contain is not a mention, so `@` in an email address or
 * a bare `@` on its own scans past. The `(?<![\w@])` guard is what stops the local
 * part of `you@example.com` reading as a mention of `example`.
 */
const MENTION_RE = /(?<![\w@])@([a-z0-9_]{2,32})/gi;

/** How many people one piece of text may notify. A caption is not a broadcast tool. */
export const MENTION_LIMIT = 5;

/**
 * The handles named in a piece of text, lowercased, deduplicated and capped.
 *
 * Pure, and exported for `test/notify-describe.test.ts` — the regex is the part
 * that decides whether an email address in a caption pings a stranger, and that is
 * not something to find out in production.
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  return [
    ...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase())),
  ].slice(0, MENTION_LIMIT);
}

/**
 * Notify everyone named in a piece of text.
 *
 * `skipUserIds` carries whoever is already being told about the same event by
 * another route — the post's author gets a COMMENT notification, so mentioning them
 * in that comment must not also produce a MENTION. Two lines in the bell for one
 * comment is worse than none.
 */
export async function notifyMentions(input: {
  text: string | null;
  actorId: string;
  postId: string;
  commentId?: string | null;
  skipUserIds?: (string | null | undefined)[];
}): Promise<void> {
  try {
    const handles = extractMentions(input.text);
    if (handles.length === 0) return;

    const skip = new Set(
      [input.actorId, ...(input.skipUserIds ?? [])].filter(
        (id): id is string => typeof id === "string",
      ),
    );

    const users = await prisma.user.findMany({
      where: { handle: { in: handles } },
      select: { id: true, isAI: true },
    });

    await Promise.all(
      users
        // The AI is not a person to be pinged. It reads the feed on its own
        // schedule and has no bell.
        .filter((u) => !u.isAI && !skip.has(u.id))
        .map((u) =>
          notify({
            userId: u.id,
            actorId: input.actorId,
            type: "MENTION",
            postId: input.postId,
            commentId: input.commentId ?? null,
          }),
        ),
    );
  } catch (err) {
    console.error("[notifications] failed to notify mentions:", err);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * A page of the bell, newest first.
 *
 * The unread total rides along with the rows rather than being a second request:
 * the badge and the list are one thing on screen, and fetching them separately
 * gives you a moment where the badge says 3 and the list shows 4.
 */
export async function fetchNotifications(
  userId: string,
  cursor?: string | null,
): Promise<ClientNotificationPage> {
  const [recipient, rows, unread] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { handle: true } }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: notificationSelect,
    }),
    unreadCount(userId),
  ]);

  if (!recipient) return { notifications: [], nextCursor: null, unread: 0 };

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return {
    notifications: page.map((row) => toClient(row, recipient.handle)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    unread,
  };
}

/**
 * Mark rows read, and return the unread total afterwards.
 *
 * `userId` is in the `where` even when an id is given — a mark-read is a write
 * driven by a client-supplied id, and scoping it to the caller is what stops one
 * person clearing somebody else's bell. `readAt: null` keeps an already-read row
 * from having its timestamp rewritten by a second click.
 */
export async function markRead(userId: string, id?: string | null): Promise<number> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return unreadCount(userId);
}
