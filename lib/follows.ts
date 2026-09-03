import "server-only";

/**
 * The follow graph.
 *
 * A `Follow` row is the whole edge — no id, just the two ends and a timestamp,
 * with the pair as the primary key. That makes "am I following them" a single
 * index lookup and makes a double-follow a constraint violation rather than a
 * duplicate row.
 *
 * The two counters on `User` are denormalised on purpose and written inside the
 * same transaction as the edge. Every profile header, every suggestion card and
 * (later) every conversation row wants a follower count; as a `COUNT(*)` that is
 * one aggregate scan per render, and there is no version of this app where the
 * counts and the edges are allowed to disagree.
 *
 * Following the AI is allowed. It posts and comments like anyone else — it is
 * only ever excluded from *scoring*, never from the graph.
 */

import { Prisma, type User } from "@prisma/client";
import { prisma } from "./prisma";
import { notify } from "./notifications";
import { PostServiceError, resolveAvatarUrl } from "./posts";
import type { ClientFollowState, ClientPeoplePage, ClientPerson } from "./types";

const PEOPLE_PAGE_SIZE = 24;

/**
 * Everything a person card draws. `theme` is here for `resolveAvatarUrl` — a
 * select without it silently falls back to the Google picture, which is the bug
 * that type exists to prevent.
 */
const personSelect = {
  id: true,
  handle: true,
  displayName: true,
  avatarUrl: true,
  isAI: true,
  bakchodScore: true,
  followersCount: true,
  theme: { select: { logoKey: true, tagline: true } },
} satisfies Prisma.UserSelect;

type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;

function toClientPerson(
  row: PersonRow,
  opts: { isFollowing: boolean | null; reason?: string | null },
): ClientPerson {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
    isAI: row.isAI,
    bakchodScore: row.bakchodScore,
    tagline: row.theme?.tagline ?? null,
    followersCount: row.followersCount,
    isFollowing: opts.isFollowing,
    reason: opts.reason ?? null,
  };
}

/**
 * Which of these people the viewer already follows.
 *
 * One query for the whole page rather than one per row, and an empty set when
 * signed out so the caller does not need a second branch.
 */
async function followedAmong(
  viewerId: string | null,
  ids: string[],
): Promise<Set<string>> {
  if (!viewerId || ids.length === 0) return new Set();
  const rows = await prisma.follow.findMany({
    where: { followerId: viewerId, followeeId: { in: ids } },
    select: { followeeId: true },
  });
  return new Set(rows.map((r) => r.followeeId));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Follow or unfollow, by handle.
 *
 * Idempotent in both directions: following someone you already follow, or
 * unfollowing someone you never followed, is a success with the counts
 * unchanged. A button that reports failure because you tapped it twice is worse
 * than one that quietly agrees with you.
 *
 * The counter updates are inside the transaction and gated on the edge actually
 * having changed, which is what stops a double-tap inflating the number. That
 * same flag comes back out as `changed`, because a re-follow must not fire a
 * second notification at someone who already got one.
 */
export async function setFollow(
  follower: User,
  handle: string,
  next: boolean,
): Promise<ClientFollowState & { targetId: string; changed: boolean }> {
  const target = await prisma.user.findUnique({
    where: { handle },
    select: { id: true },
  });
  if (!target) throw new PostServiceError("No such person.", 404);
  if (target.id === follower.id) {
    throw new PostServiceError("You cannot follow yourself.", 400);
  }

  const changed = await prisma.$transaction(async (tx) => {
    if (next) {
      try {
        await tx.follow.create({
          data: { followerId: follower.id, followeeId: target.id },
        });
      } catch (err) {
        // P2002 is the composite key doing its job: the edge was already there.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return false;
        }
        throw err;
      }
    } else {
      const { count } = await tx.follow.deleteMany({
        where: { followerId: follower.id, followeeId: target.id },
      });
      if (count === 0) return false;
    }

    const step = next ? 1 : -1;
    await Promise.all([
      tx.user.update({
        where: { id: follower.id },
        data: { followingCount: { increment: step } },
      }),
      tx.user.update({
        where: { id: target.id },
        data: { followersCount: { increment: step } },
      }),
    ]);
    return true;
  });

  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
    select: { followersCount: true, followingCount: true },
  });

  // Gated on `changed`, so tapping Follow twice — or unfollowing and following
  // again inside a second — does not produce a second line in their bell. An
  // unfollow notifies nobody: there is no version of that message worth sending.
  if (changed && next) {
    void notify({ userId: target.id, actorId: follower.id, type: "FOLLOW" });
  }

  return {
    targetId: target.id,
    changed,
    followersCount: fresh.followersCount,
    followingCount: fresh.followingCount,
    isFollowing: next,
  };
}

/**
 * Whether the edge already exists. Cheap enough to call per profile render — it
 * is a primary-key lookup.
 */
export async function isFollowing(
  viewerId: string | null,
  targetId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === targetId) return false;
  const row = await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId: viewerId, followeeId: targetId } },
    select: { followerId: true },
  });
  return row !== null;
}

/** Ids the viewer follows, for the feed blend. Bounded so the `IN` stays sane. */
export async function followedIds(viewerId: string, take = 1000): Promise<string[]> {
  const rows = await prisma.follow.findMany({
    where: { followerId: viewerId },
    orderBy: { createdAt: "desc" },
    take,
    select: { followeeId: true },
  });
  return rows.map((r) => r.followeeId);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The counts and the viewer's own edge, for a profile header. */
export async function fetchFollowState(
  targetId: string,
  viewerId: string | null,
): Promise<ClientFollowState> {
  const [row, following] = await Promise.all([
    prisma.user.findUnique({
      where: { id: targetId },
      select: { followersCount: true, followingCount: true },
    }),
    isFollowing(viewerId, targetId),
  ]);

  return {
    followersCount: row?.followersCount ?? 0,
    followingCount: row?.followingCount ?? 0,
    // Null rather than false when there is no button to draw: signed out, or
    // looking at yourself.
    isFollowing: !viewerId || viewerId === targetId ? null : following,
  };
}

/**
 * One page of followers or following.
 *
 * The cursor is the *other* end's id, which works because the edge table's
 * primary key is the pair — so `(fixed end, cursor)` is a unique row and paging
 * never skips or repeats. Ordering is by `createdAt` desc, which the composite
 * indexes on `Follow` already cover.
 */
export async function fetchFollowList(
  handle: string,
  direction: "followers" | "following",
  viewerId: string | null,
  cursor?: string | null,
): Promise<ClientPeoplePage> {
  const owner = await prisma.user.findUnique({
    where: { handle },
    select: { id: true },
  });
  if (!owner) throw new PostServiceError("No such person.", 404);

  const take = PEOPLE_PAGE_SIZE + 1;

  // Branched rather than one query with conditional selects: Prisma types the
  // included relation off the literal, so a `follower: undefined` here would give
  // the row a shape TypeScript cannot narrow afterwards.
  const rows =
    direction === "followers"
      ? (
          await prisma.follow.findMany({
            where: { followeeId: owner.id },
            orderBy: [{ createdAt: "desc" }, { followerId: "desc" }],
            take,
            ...(cursor
              ? {
                  cursor: {
                    followerId_followeeId: {
                      followerId: cursor,
                      followeeId: owner.id,
                    },
                  },
                  skip: 1,
                }
              : {}),
            select: { followerId: true, follower: { select: personSelect } },
          })
        ).map((r) => ({ edgeId: r.followerId, person: r.follower }))
      : (
          await prisma.follow.findMany({
            where: { followerId: owner.id },
            orderBy: [{ createdAt: "desc" }, { followeeId: "desc" }],
            take,
            ...(cursor
              ? {
                  cursor: {
                    followerId_followeeId: {
                      followerId: owner.id,
                      followeeId: cursor,
                    },
                  },
                  skip: 1,
                }
              : {}),
            select: { followeeId: true, followee: { select: personSelect } },
          })
        ).map((r) => ({ edgeId: r.followeeId, person: r.followee }));

  const hasMore = rows.length > PEOPLE_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PEOPLE_PAGE_SIZE) : rows;

  const followed = await followedAmong(viewerId, page.map((r) => r.person.id));

  return {
    people: page.map((r) =>
      toClientPerson(r.person, {
        isFollowing:
          !viewerId || viewerId === r.person.id ? null : followed.has(r.person.id),
      }),
    ),
    nextCursor: hasMore ? page[page.length - 1].edgeId : null,
  };
}

/**
 * People worth following, best first.
 *
 * Two passes, cheapest signal first:
 *
 *   1. Friends of friends — people followed by the people you follow. This is
 *      the only suggestion anyone actually acts on, and it comes with a reason
 *      you can print on the card.
 *   2. Whoever is being followed most, to fill the rest. A brand-new account
 *      follows nobody, so pass 1 returns nothing and this is the entire list.
 *
 * Deliberately not ranked by `bakchodScore`: "follow the biggest bakchod" is the
 * leaderboard's job, and a suggestion rail that mirrors it would be a second
 * leaderboard. The AI is eligible for pass 2 like anyone else — its card just
 * never shows a number.
 */
export async function fetchSuggestions(
  viewerId: string | null,
  take = 5,
): Promise<ClientPerson[]> {
  if (!viewerId) {
    const rows = await prisma.user.findMany({
      where: { followersCount: { gt: 0 } },
      orderBy: [{ followersCount: "desc" }, { id: "asc" }],
      take,
      select: personSelect,
    });
    return rows.map((r) => toClientPerson(r, { isFollowing: null }));
  }

  const mine = await followedIds(viewerId);
  const exclude = [viewerId, ...mine];

  const out: ClientPerson[] = [];
  const chosen = new Set(exclude);

  if (mine.length > 0) {
    // Grouping by followee gives the "how many of your people follow them" count
    // in the same pass that finds them.
    const mutual = await prisma.follow.groupBy({
      by: ["followeeId"],
      where: { followerId: { in: mine }, followeeId: { notIn: exclude } },
      _count: { followeeId: true },
      orderBy: { _count: { followeeId: "desc" } },
      take,
    });

    if (mutual.length > 0) {
      const rows = await prisma.user.findMany({
        where: { id: { in: mutual.map((m) => m.followeeId) } },
        select: personSelect,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      for (const m of mutual) {
        const row = byId.get(m.followeeId);
        if (!row) continue;
        const n = m._count.followeeId;
        out.push(
          toClientPerson(row, {
            isFollowing: false,
            reason: `Followed by ${n} ${n === 1 ? "person" : "people"} you follow`,
          }),
        );
        chosen.add(row.id);
      }
    }
  }

  if (out.length < take) {
    const rows = await prisma.user.findMany({
      where: { id: { notIn: [...chosen] } },
      orderBy: [{ followersCount: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: take - out.length,
      select: personSelect,
    });
    for (const row of rows) {
      out.push(toClientPerson(row, { isFollowing: false }));
    }
  }

  return out.slice(0, take);
}
