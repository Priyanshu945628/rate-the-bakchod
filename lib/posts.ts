import "server-only";

/**
 * Domain logic for posts, ratings, comments and reports.
 *
 * The rating path is the interesting one: it maintains three sets of
 * denormalised aggregates (post, author, global) inside a single transaction so
 * the leaderboard can be a plain indexed ORDER BY instead of an aggregate scan.
 *
 * The AI account is excluded from all of it. Per the platform rule, the bot's
 * points are never calculated: its posts cannot be rated, and if it ever did
 * rate something that rating would not reach the global mean.
 */

import { Prisma, type PostKind, type User } from "@prisma/client";
import { cache } from "react";
import { profileAssetUrl, resolveAvatarUrl, type AvatarSource } from "./avatar";
import { feedBlend, limits } from "./config";
import { prisma } from "./prisma";
import { notify, notifyMentions } from "./notifications";
import { bakchodScore, globalMean, hotScore } from "./scoring";
import { normalizeUpload } from "./media/pipeline";
import { sealMedia } from "./media/store";
import { enqueueArchiveUpload } from "./archive-queue";
import type { FeedTab } from "./feed-tabs";
import { storyExpiresAt } from "./story-window";
import type {
  ClientComment,
  ClientPost,
  ClientProfile,
  ClientProfileLink,
  ClientProfileTheme,
  ClientViewer,
  LeaderboardRow,
} from "./types";

export class PostServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "PostServiceError";
  }
}

/**
 * What "a post on the feed" means, in one place.
 *
 * Stories are `Post` rows — that is how they inherit the whole encrypted upload
 * path for free — and the price of that decision is this clause. Every query that
 * means "feed post" has to exclude them, and scattering `isStory: false` across
 * the file guarantees that one day one of them gets missed. So it is written once
 * here, spread into each `where`, and asserted in `test/feed-scope.test.ts`.
 *
 * Two places deliberately do *not* use it:
 *   - reports, because a story should still be reportable
 *   - `fetchLeaderboard`, which reads `User` aggregates and never touches posts
 */
export const FEED_SCOPE = { isHidden: false, isStory: false } as const;

// ---------------------------------------------------------------------------
// Creating posts
// ---------------------------------------------------------------------------

function cleanCaption(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > limits.captionMaxLength) {
    throw new PostServiceError(
      `Caption is too long (max ${limits.captionMaxLength} characters).`,
    );
  }
  return trimmed;
}

/** The pasted words of a TWEET post, held to the same limit on create and on edit. */
function cleanTweetText(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > limits.tweetMaxLength) {
    throw new PostServiceError(
      `Tweet text is too long (max ${limits.tweetMaxLength} characters).`,
    );
  }
  return trimmed;
}

export interface CreatePostInput {
  author: User;
  caption?: string | null;
  /** Raw upload bytes. Omit for a text-only tweet post. */
  file?: Buffer | null;
  /** Pasted tweet text, for a TWEET post with no screenshot. */
  tweetText?: string | null;
  /**
   * Create this as a story instead of a feed post: it appears in the tray for
   * `limits.storyTtlMs`, is not rateable, and does not show up in the feed or in
   * the profile's post count.
   */
  story?: boolean;
  /**
   * Mark this as a platform announcement: badged on the card, and not rateable.
   *
   * Never taken from a request body as-is — `POST /api/posts` only forwards it for
   * an admin. See `Post.isOfficial`.
   */
  official?: boolean;
}

export async function createPost(input: CreatePostInput) {
  const caption = cleanCaption(input.caption);
  const tweetText = cleanTweetText(input.tweetText);
  const isStory = input.story === true;
  // An announcement that vanishes in a day is not an announcement.
  const isOfficial = input.official === true && !isStory;

  if (!input.file && !tweetText) {
    throw new PostServiceError("Add a file or some tweet text.");
  }
  // A text-only story would be a tweet nobody can rate that vanishes in a day.
  // The DB's story/expiry CHECK constraint would accept it; the product should not.
  if (isStory && !input.file) {
    throw new PostServiceError("A story needs an image, video or clip.");
  }

  // Text-only post: nothing to encrypt, nothing to archive.
  if (!input.file) {
    const post = await prisma.post.create({
      data: {
        authorId: input.author.id,
        kind: "TWEET",
        caption,
        tweetText,
        isOfficial,
        // Nothing to upload, so it is trivially "archived".
        archiveState: "VERIFIED",
      },
    });
    void notifyMentions({
      text: `${caption ?? ""} ${tweetText ?? ""}`,
      actorId: input.author.id,
      postId: post.id,
    });
    return post;
  }

  const media = await normalizeUpload(input.file);

  // Exact-duplicate guard. Same bytes already posted means someone is farming
  // the feed; point them at the original instead of creating a second copy.
  //
  // Stories sit outside this in both directions: FEED_SCOPE means an existing
  // story never blocks a post, and a story is not checked at all. Posting a clip
  // to your story and later to the feed is normal use, not farming.
  if (!isStory) {
    const duplicate = await prisma.post.findFirst({
      where: { sha256: media.sha256, ...FEED_SCOPE },
      select: { id: true },
    });
    if (duplicate) {
      throw new PostServiceError(
        "This exact file is already on the feed.",
        409,
      );
    }
  }

  const sealed = await sealMedia(media);
  const kind: PostKind = media.kind;

  const post = await prisma.post.create({
    data: {
      authorId: input.author.id,
      kind: tweetText ? "TWEET" : kind,
      caption,
      tweetText,
      isOfficial,
      archiveState: "PENDING",
      isStory,
      storyExpiresAt: isStory ? storyExpiresAt(new Date()) : null,
      ...sealed.columns,
    },
  });

  // The post is already live off the disk cache; the archive upload runs behind
  // it and promotes the row's state when it lands.
  enqueueArchiveUpload(post.id, sealed.uploads);

  // Stories are excluded: a story is seen by whoever opens it, and a mention there
  // would notify someone about something that expires before they look.
  if (!isStory) {
    void notifyMentions({
      text: `${caption ?? ""} ${tweetText ?? ""}`,
      actorId: input.author.id,
      postId: post.id,
    });
  }

  return post;
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

const RECENT_WINDOW_MS = 24 * 3_600_000;

export async function submitRating(rater: User, postId: string, value: number) {
  const { authorId, ...result } = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        isHidden: true,
        isStory: true,
        isOfficial: true,
        createdAt: true,
        ratingsSum: true,
        ratingsCount: true,
        author: { select: { id: true, isAI: true, ratingsSum: true, ratingsCount: true } },
      },
    });

    if (!post || post.isHidden) {
      throw new PostServiceError("That post is gone.", 404);
    }
    if (post.isStory) {
      // Stories are ephemeral by design. Scoring something that disappears in a
      // day would let people farm a permanent score off temporary evidence.
      throw new PostServiceError("Stories are not rated. Post it to the feed for that.", 400);
    }
    if (post.author.isAI) {
      // The AI is never scored. This is the rule, enforced at the door.
      throw new PostServiceError("The AI bakchod is above your judgement.", 400);
    }
    if (post.isOfficial) {
      // A platform update is not evidence of bakchodi, so it carries no score. The
      // card draws no rater either; this is the half that a hand-built request hits.
      throw new PostServiceError("Platform updates are not rated.", 400);
    }
    if (post.authorId === rater.id) {
      throw new PostServiceError("You cannot rate your own bakchodi.", 400);
    }

    try {
      await tx.rating.create({
        data: { postId, raterId: rater.id, value },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new PostServiceError("You have already rated this one.", 409);
      }
      throw err;
    }

    const postSum = post.ratingsSum + value;
    const postCount = post.ratingsCount + 1;

    // Ratings from the AI would never reach here (it does not rate), but the
    // guard keeps the global mean honest if that ever changes.
    const countsGlobally = !rater.isAI;

    const stats = countsGlobally
      ? await tx.globalStats.upsert({
          where: { id: 1 },
          create: { id: 1, totalSum: value, totalCount: 1 },
          update: { totalSum: { increment: value }, totalCount: { increment: 1 } },
        })
      : await tx.globalStats.findUnique({ where: { id: 1 } });

    const mean = globalMean(stats?.totalSum ?? 0, stats?.totalCount ?? 0);

    const authorSum = post.author.ratingsSum + value;
    const authorCount = post.author.ratingsCount + 1;

    const recentRatings = await tx.rating.count({
      where: {
        postId,
        createdAt: { gte: new Date(Date.now() - RECENT_WINDOW_MS) },
      },
    });

    const [updatedPost, updatedAuthor] = await Promise.all([
      tx.post.update({
        where: { id: postId },
        data: {
          ratingsSum: postSum,
          ratingsCount: postCount,
          hotScore: hotScore(recentRatings, post.createdAt),
        },
        select: { ratingsSum: true, ratingsCount: true },
      }),
      tx.user.update({
        where: { id: post.authorId },
        data: {
          ratingsSum: authorSum,
          ratingsCount: authorCount,
          bakchodScore: bakchodScore(authorSum, authorCount, mean),
        },
        select: { bakchodScore: true },
      }),
    ]);

    return {
      postAverage: updatedPost.ratingsSum / updatedPost.ratingsCount,
      postRatingsCount: updatedPost.ratingsCount,
      authorScore: updatedAuthor.bakchodScore,
      authorId: post.authorId,
    };
  });

  // Outside the transaction, and not awaited. A notification must never be able to
  // roll a rating back, and publishing from inside would push an event about a
  // rating that had not committed yet.
  void notify({ userId: authorId, actorId: rater.id, type: "RATING", postId });

  return result;
}

// ---------------------------------------------------------------------------
// Comments and reports
// ---------------------------------------------------------------------------

/**
 * Everything a comment needs to draw its author, including the theme field that
 * decides which picture is theirs. One constant rather than two literals, because
 * the two places comments are read — writing one and listing them — have to agree
 * or a fresh comment renders with a different avatar to the ones above it.
 */
const commentAuthorSelect = {
  handle: true,
  displayName: true,
  avatarUrl: true,
  isAI: true,
  theme: { select: { logoKey: true } },
} satisfies Prisma.UserSelect;

export async function addComment(
  author: User,
  postId: string,
  body: string,
  isAI = false,
) {
  const text = body.trim();
  if (!text) throw new PostServiceError("Say something.");
  if (text.length > limits.commentMaxLength) {
    throw new PostServiceError(
      `Comment is too long (max ${limits.commentMaxLength} characters).`,
    );
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true, authorId: true },
  });
  if (!post || post.isHidden) throw new PostServiceError("That post is gone.", 404);

  const comment = await prisma.comment.create({
    data: { postId, authorId: author.id, body: text, isAI },
    include: {
      author: { select: commentAuthorSelect },
    },
  });

  // The AI's comments say so, because an unexplained roast from an account you
  // never interacted with reads as a person. Both still land in the same bell.
  void notify({
    userId: post.authorId,
    actorId: author.id,
    type: isAI ? "AI_COMMENT" : "COMMENT",
    postId,
    commentId: comment.id,
  });

  // The author is skipped: they are already being told about this comment, and one
  // action should not produce two lines.
  void notifyMentions({
    text: text,
    actorId: author.id,
    postId,
    commentId: comment.id,
    skipUserIds: [post.authorId],
  });

  return comment;
}

export async function reportPost(reporter: User, postId: string, reason: string) {
  const text = reason.trim().slice(0, 300);
  if (!text) throw new PostServiceError("Tell us what is wrong with it.");

  try {
    return await prisma.report.create({
      data: { postId, reporterId: reporter.id, reason: text },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new PostServiceError("You already reported this one.", 409);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// An author's own post
// ---------------------------------------------------------------------------

/**
 * The one post a query like this may act on: yours, still standing, not a story.
 *
 * `authorId` belongs in the `where` and not in an `if` above it. Somebody else's
 * post and a post that was never there come back as the same absent row, and get
 * the same 404 — there is no reply that confirms a post exists but is not yours.
 * `FEED_SCOPE` adds the rest: a story is `deleteStory`'s business, and an
 * already-deleted post has nothing left to change.
 *
 * The row rather than the id, because what an author may change depends on what the
 * post is: `storageKey` is null on a text-only post, which is the one post whose
 * words cannot be taken away without leaving an empty card behind.
 */
async function ownPost(
  author: User,
  postId: string,
): Promise<{ id: string; kind: PostKind; storageKey: string | null }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, authorId: author.id, modDeletedAt: null, ...FEED_SCOPE },
    select: { id: true, kind: true, storageKey: true },
  });
  if (!post) throw new PostServiceError("That is not your post.", 404);
  return post;
}

export interface PostEdit {
  caption?: string | null;
  /** Only on a TWEET post — the quoted words. */
  tweetText?: string | null;
}

/**
 * Rewrite your own words.
 *
 * The words are the only part of a post its author can revise, and that is not a
 * missing feature. The media is encrypted, hashed against duplicates and already
 * archived, so replacing it would be a different post; the score underneath it is
 * other people's opinion of what they actually saw. What is left is the caption and,
 * on a tweet post, the text that was pasted in — both held to the limits they were
 * held to the first time.
 *
 * An absent key means "leave it alone", so the editor can save one field without
 * clearing the other.
 *
 * Mentions are deliberately not re-scanned. `createPost` notifies whoever a post
 * names, once; doing it again per edit would make an edit box a way to ring the same
 * bell as often as you like.
 */
export async function editPost(
  author: User,
  postId: string,
  edit: PostEdit,
): Promise<{ caption: string | null; tweetText: string | null }> {
  const data: { caption?: string | null; tweetText?: string | null } = {};

  if ("caption" in edit) {
    if (edit.caption !== null && typeof edit.caption !== "string") {
      throw new PostServiceError("Caption has to be text.");
    }
    data.caption = cleanCaption(edit.caption);
  }

  const post = await ownPost(author, postId);

  if ("tweetText" in edit) {
    if (edit.tweetText !== null && typeof edit.tweetText !== "string") {
      throw new PostServiceError("Tweet text has to be text.");
    }
    // Adding tweet text to a post that is not one would change what the card *is* —
    // `createPost` is what decides that, from whether text was pasted at all.
    if (post.kind !== "TWEET") {
      throw new PostServiceError("That post has no tweet text.");
    }
    const text = cleanTweetText(edit.tweetText);
    if (!text && !post.storageKey) {
      throw new PostServiceError("A text post needs its text.");
    }
    data.tweetText = text;
  }

  if (Object.keys(data).length === 0) {
    throw new PostServiceError("Nothing to change.");
  }

  // The row's own values back, not the draft: whatever was trimmed or left alone is
  // what the card should now be showing.
  return prisma.post.update({
    where: { id: post.id },
    data,
    select: { caption: true, tweetText: true },
  });
}

/**
 * Delete your own post.
 *
 * The same crypto-shred `deleteStory` performs, for the same reason: the ciphertext
 * is on the Internet Archive, which has no delete, so destroying the wrapped key
 * *is* the deletion. Three nulled columns, and the bytes can never be read again by
 * anyone, this app included.
 *
 * The row stays, hidden, and so do the ratings hanging off it — `User.ratingsSum`
 * and `ratingsCount` are accumulated as ratings arrive and are never walked back.
 * That is deliberate twice over: those people really did rate what they saw, and a
 * score you could raise by deleting your worst post would not be a score.
 *
 * What the profile *counts* is a different question, and the answer there is the
 * opposite one — see {@link PROFILE_STAT_COUNTS}. A held score is a judgement the
 * crowd made; a comment on a hidden post is just a row nobody can reach.
 */
export async function deleteOwnPost(author: User, postId: string): Promise<void> {
  const { id } = await ownPost(author, postId);

  await prisma.$transaction([
    prisma.post.update({
      where: { id },
      data: {
        isHidden: true,
        hiddenAt: new Date(),
        wrappedKey: null,
        keyIv: null,
        keyTag: null,
      },
    }),
    // A pin to a post that no longer renders already resolves to nothing, so this
    // tidies rather than fixes — but it keeps "pinned" from being a setting that
    // silently points at a deleted post.
    prisma.profileTheme.updateMany({
      where: { userId: author.id, pinnedPostId: id },
      data: { pinnedPostId: null },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Reading the feed
// ---------------------------------------------------------------------------

// Tab names and parsing live in lib/feed-tabs, which is import-safe from client
// components; this module is server-only.
export type { FeedTab };
export { parseTab as parseFeedTab } from "./feed-tabs";

const FEED_PAGE_SIZE = 12;

const feedSelect = {
  id: true,
  kind: true,
  caption: true,
  tweetText: true,
  storageKey: true,
  posterKey: true,
  mimeType: true,
  width: true,
  height: true,
  durationMs: true,
  archiveState: true,
  ratingsSum: true,
  ratingsCount: true,
  isOfficial: true,
  createdAt: true,
  // Carried so a tombstone can render as one. Every query except the author's own
  // profile excludes these rows anyway, so on the feed this is always null.
  modDeletedAt: true,
  author: {
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isAI: true,
      bakchodScore: true,
      // Not decoration: this is where an uploaded profile picture lives, and
      // `resolveAvatarUrl` needs it to prefer that over the Google one.
      theme: { select: { logoKey: true } },
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.PostSelect;

export type FeedPost = Prisma.PostGetPayload<{ select: typeof feedSelect }> & {
  viewerRating: number | null;
};

export interface FeedPage {
  posts: FeedPost[];
  nextCursor: string | null;
}

export async function fetchFeed(options: {
  tab: FeedTab;
  cursor?: string | null;
  viewerId?: string | null;
  /** Restrict to one person's posts — this is what a profile page renders. */
  authorHandle?: string | null;
  /**
   * Also return this author's mod-deleted posts, as tombstones.
   *
   * Only ever set when the viewer *is* the author — both call sites derive it from
   * that, never from anything a client sends. `authorHandle` is required with it:
   * "my deleted posts" is a profile question, and mixing tombstones into a public
   * feed would show everyone what a moderator took down.
   */
  withTombstones?: boolean;
}): Promise<FeedPage> {
  const { tab, cursor, viewerId, authorHandle } = options;
  const withTombstones = options.withTombstones === true && Boolean(authorHandle);

  // For You is a blend of three queries rather than one ordering, so it has its
  // own path. It needs a viewer to have a graph at all, and it is meaningless
  // scoped to a single author — both fall through to Fresh rather than erroring,
  // because a hand-typed `?tab=foryou` should show a feed, not a stack trace.
  if (tab === "foryou" && viewerId && !authorHandle) {
    return fetchForYou(viewerId, cursor);
  }

  // Every ordering ends with id so the cursor is deterministic even when the
  // leading key ties — otherwise infinite scroll silently skips or repeats rows.
  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    tab === "top"
      ? [{ ratingsSum: "desc" }, { id: "desc" }]
      : tab === "trending"
        ? [{ hotScore: "desc" }, { id: "desc" }]
        : [{ createdAt: "desc" }, { id: "desc" }];

  const rows = await prisma.post.findMany({
    where: {
      // A tombstone is `isHidden`, so it has to be let back in explicitly rather
      // than by relaxing the scope: `isHidden: false` OR mod-deleted keeps a post
      // hidden by ADMIN_HIDE invisible even to its author, which is what that
      // action means. Only a deletion leaves a marker. `isStory` still comes from
      // FEED_SCOPE — a deleted story is not a feed row either way.
      ...(withTombstones
        ? {
            isStory: FEED_SCOPE.isStory,
            OR: [{ isHidden: false }, { modDeletedAt: { not: null } }],
          }
        : FEED_SCOPE),
      // Filtering by handle rather than id keeps the caller from having to
      // resolve one first; handle is unique, so this is an index lookup.
      ...(authorHandle ? { author: { handle: authorHandle } } : {}),
    },
    select: feedSelect,
    orderBy,
    take: FEED_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;

  return {
    posts: await attachViewerRatings(page, viewerId ?? null),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Fill in what the viewer already rated, in one query for the whole page.
 *
 * One query rather than one per row, and its own function rather than two inline
 * copies — the ordinary tabs and the For You blend both need it, and two copies
 * would eventually disagree about whether an unrated post is `null` or `0`, which
 * the slider renders very differently.
 */
async function attachViewerRatings(
  rows: Prisma.PostGetPayload<{ select: typeof feedSelect }>[],
  viewerId: string | null,
): Promise<FeedPost[]> {
  if (!viewerId || rows.length === 0) {
    return rows.map((p) => ({ ...p, viewerRating: null }));
  }
  const mine = await prisma.rating.findMany({
    where: { raterId: viewerId, postId: { in: rows.map((p) => p.id) } },
    select: { postId: true, value: true },
  });
  const byPost = new Map(mine.map((r) => [r.postId, r.value]));
  return rows.map((p) => ({ ...p, viewerRating: byPost.get(p.id) ?? null }));
}

/**
 * Posts whose caption or tweet text contains `query`, newest first.
 *
 * The Fresh tab with one more clause in its `where`, deliberately: same scope, same
 * ordering, same id cursor, so a result opens, rates and pages exactly like the feed
 * row it is. Nothing is ranked — every hit is a substring match, so the only signal
 * left to sort by is recency, which is the order the reader is already in.
 *
 * `mode: "insensitive"` is the whole matcher. No `tsvector`: these captions are
 * Hinglish, and every dictionary Postgres ships would treat `bakchodi` and `bakchod`
 * as two unrelated words — so full-text search would cost an index and a column to
 * match *less* than `ILIKE` does. The index that makes this fast is a trigram one,
 * which needs no opinion about the language.
 *
 * Not scoped by the author's profile visibility, exactly like `fetchFeed`: a post is
 * public or it is not in the table.
 */
export async function searchPosts(options: {
  query: string;
  cursor?: string | null;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const { query, cursor, viewerId } = options;

  const rows = await prisma.post.findMany({
    where: {
      ...FEED_SCOPE,
      OR: [
        { caption: { contains: query, mode: "insensitive" } },
        { tweetText: { contains: query, mode: "insensitive" } },
      ],
    },
    select: feedSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FEED_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;

  return {
    posts: await attachViewerRatings(page, viewerId ?? null),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

// ---------------------------------------------------------------------------
// For You
// ---------------------------------------------------------------------------

/**
 * How deep For You goes before it stops.
 *
 * The blend is computed from the top of three pools every time, so serving offset
 * N costs N rows of work. That is fine for a feed nobody scrolls past a few
 * hundred posts of, and a hard ceiling is what keeps a scripted client from
 * turning `?cursor=` into an expensive table walk. Past it the feed ends and the
 * other tabs are still there.
 */
const FOR_YOU_MAX = 240;

/** How far into the discovery pool a session may start. */
const DISCOVERY_ROTATE = 12;

/**
 * Where a For You reader is, encoded opaquely.
 *
 * `seed` fixes which slice of the discovery pool this session sees, so two people
 * with the same follow graph do not get the same strangers, and reloading the page
 * shows different new faces. `offset` is how many blended posts have been handed
 * out. Both have to travel together — an offset applied to a different seed would
 * be pointing into a different list.
 *
 * Base64 rather than `seed:offset` so it reads as a cursor and nobody is tempted
 * to hand-edit one; it is obfuscation, not security, and there is nothing secret
 * in it.
 */
interface ForYouCursor {
  seed: number;
  offset: number;
}

function encodeForYouCursor(state: ForYouCursor): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

/**
 * Decode a cursor, or start a fresh session.
 *
 * Anything unparseable becomes a new session at offset 0 rather than an error: a
 * truncated or stale cursor should show someone the top of their feed, not a
 * failure.
 */
function decodeForYouCursor(raw: string | null | undefined): ForYouCursor {
  const fresh = { seed: Math.floor(Math.random() * 1_000_000), offset: 0 };
  if (!raw) return fresh;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return fresh;
    const { seed, offset } = parsed as Record<string, unknown>;
    if (typeof seed !== "number" || typeof offset !== "number") return fresh;
    if (!Number.isFinite(seed) || !Number.isFinite(offset)) return fresh;
    return {
      seed: Math.abs(Math.trunc(seed)) % 1_000_000,
      offset: Math.min(Math.max(Math.trunc(offset), 0), FOR_YOU_MAX),
    };
  } catch {
    return fresh;
  }
}

/**
 * One source the blend draws from.
 *
 * `complete` is load-bearing, not bookkeeping. Every pool is fetched with a
 * `take`, so a spent buffer means one of two very different things: the query
 * returned everything there is, or it was cut off. In the first case the blend may
 * carry on with the other pools; in the second it must stop, because what comes
 * after the cut is unknown and a guess here would make this page disagree with the
 * next one.
 */
export interface FeedPool<T> {
  items: T[];
  /** True when the query returned everything, so the end of `items` is a real end. */
  complete: boolean;
}

/**
 * Interleave the three pools at the configured ratio.
 *
 * Pure and deterministic — the randomness in For You is entirely in which slice
 * of `discovery` the caller fetched, never in here — so the same three pools
 * always blend to the same list.
 *
 * `fresh` is not a third voice in the ratio; it is the backstop. When the pool a
 * slot asked for is genuinely empty the slot is filled from whatever is left, so a
 * brand new account that follows nobody still gets a full feed instead of a page
 * with three posts on it.
 *
 * The one property everything else rests on: **a longer fetch of the same pools
 * blends to a list that starts with the shorter one.** That is what lets the
 * caller page by offset — page 2 recomputes the blend from deeper pools and can
 * trust that the rows it already served are still exactly the first N. Stopping at
 * a truncated pool rather than borrowing across it is what buys that, and
 * `test/feed-blend.test.ts` is what keeps it.
 */
export function blendFeed<T extends { id: string }>(
  followed: FeedPool<T>,
  discovery: FeedPool<T>,
  fresh: FeedPool<T>,
): T[] {
  const pools = { followed, discovery, fresh };
  type Key = keyof typeof pools;

  const at: Record<Key, number> = { followed: 0, discovery: 0, fresh: 0 };
  const out: T[] = [];
  const used = new Set<string>();

  /**
   * The next unused row, or why there is not one: `"drained"` when the pool is
   * complete and spent, `"unknown"` when it was only truncated.
   */
  function pull(key: Key): T | "drained" | "unknown" {
    const { items, complete } = pools[key];
    while (at[key] < items.length) {
      const row = items[at[key]++];
      if (!used.has(row.id)) return row;
    }
    return complete ? "drained" : "unknown";
  }

  const order: Key[] = ["followed", "discovery", "fresh"];
  const cycle = feedBlend.followed + feedBlend.discovery;

  for (let slot = 0; ; slot += 1) {
    const wants: Key =
      slot % cycle < feedBlend.followed ? "followed" : "discovery";

    let picked: T | null = null;
    for (const key of [wants, ...order.filter((k) => k !== wants)]) {
      const next = pull(key);
      // Truncated and spent. Borrowing from another pool here would produce a
      // row that a deeper fetch would not have put in this slot, and every row
      // after it would shift — so the blend ends instead.
      if (next === "unknown") break;
      if (next === "drained") continue;
      picked = next;
      break;
    }

    // Either nothing is left anywhere, or the pool we needed ran out early.
    if (!picked) break;

    used.add(picked.id);
    out.push(picked);
  }

  return out;
}

/** A pool from a `findMany` that asked for `take` rows. */
function toPool<T>(items: T[], take: number): FeedPool<T> {
  return { items, complete: items.length < take };
}

/**
 * The blended feed.
 *
 * Three pools, in the order they matter:
 *
 *   - **Followed** — chronological, because among people you chose to follow
 *     "newest" is the only ranking anybody wants. Nothing is filtered out of this
 *     pool: a post from someone you follow always gets its slot, even one you have
 *     already rated.
 *   - **Discovery** — people you do *not* follow, ranked by `hotScore`, which is
 *     what makes this "who is worth seeing right now" rather than "who posted
 *     last". The session's seed decides how far in it starts.
 *   - **Fresh** — the newest of everything, used only to fill slots the other two
 *     could not.
 *
 * Discovery and fresh both drop posts the viewer has already rated and posts the
 * viewer wrote. Rating something is the engagement this whole app is built on;
 * showing it again is asking a question already answered, and your own bakchodi is
 * not a discovery. Neither exclusion applies to the followed pool, so nothing a
 * friend posts ever silently vanishes from your feed.
 */
async function fetchForYou(
  viewerId: string,
  rawCursor?: string | null,
): Promise<FeedPage> {
  const { seed, offset } = decodeForYouCursor(rawCursor);
  if (offset >= FOR_YOU_MAX) return { posts: [], nextCursor: null };

  // One more than the page so the blend can tell whether there is another page.
  // Every pool is fetched to this depth, which is deeper than the blend can spend
  // — the followed pool only fills three slots in four — so a full page is always
  // reachable without a second round trip.
  const need = Math.min(offset + FEED_PAGE_SIZE + 1, FOR_YOU_MAX + 1);
  const rotate = seed % DISCOVERY_ROTATE;

  const follows = await prisma.follow.findMany({
    where: { followerId: viewerId },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { followeeId: true },
  });
  const followedAuthors = follows.map((f) => f.followeeId);

  /** Already rated, or mine. Excluded from the two stranger pools. */
  const unseenByViewer: Prisma.PostWhereInput = {
    authorId: { not: viewerId },
    NOT: { ratings: { some: { raterId: viewerId } } },
  };

  const [followedRows, discoveryRaw, freshRows] = await Promise.all([
    followedAuthors.length > 0
      ? prisma.post.findMany({
          where: { ...FEED_SCOPE, authorId: { in: followedAuthors } },
          select: feedSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: need,
        })
      : Promise.resolve([]),

    prisma.post.findMany({
      where: {
        ...FEED_SCOPE,
        ...unseenByViewer,
        ...(followedAuthors.length > 0
          ? { authorId: { notIn: [...followedAuthors, viewerId] } }
          : {}),
      },
      select: feedSelect,
      orderBy: [{ hotScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      // The rotation is fetched on top and sliced off the front below.
      take: need + rotate,
    }),

    prisma.post.findMany({
      where: { ...FEED_SCOPE, ...unseenByViewer },
      select: feedSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: need,
    }),
  ]);

  const blended = blendFeed(
    // Empty because they follow nobody is a real end, not a truncation, so this
    // pool is complete either way.
    followedAuthors.length > 0
      ? toPool(followedRows, need)
      : { items: followedRows, complete: true },
    // Dropping a constant number off the front keeps the list stable as `need`
    // grows: page 2 sees the same discovery ordering page 1 did, minus the same
    // prefix, which is what offset paging needs to not skip or repeat.
    { ...toPool(discoveryRaw, need + rotate), items: discoveryRaw.slice(rotate) },
    toPool(freshRows, need),
  );

  const window = blended.slice(offset, offset + FEED_PAGE_SIZE);
  const hasMore =
    blended.length > offset + FEED_PAGE_SIZE && offset + FEED_PAGE_SIZE < FOR_YOU_MAX;

  return {
    posts: await attachViewerRatings(window, viewerId),
    nextCursor: hasMore
      ? encodeForYouCursor({ seed, offset: offset + FEED_PAGE_SIZE })
      : null,
  };
}

/**
 * One post by id, scoped to its author.
 *
 * Used for the pinned post on a profile. The `authorId` in the `where` is not
 * belt-and-braces: it means a pin that has since changed hands, been hidden, or been
 * turned into a story quietly stops rendering instead of showing somebody else's
 * post above your feed. `FEED_SCOPE` covers the hidden and story cases.
 */
export async function fetchPinnedPost(
  postId: string,
  authorId: string,
  viewerId?: string | null,
): Promise<FeedPost | null> {
  const post = await prisma.post.findFirst({
    where: { id: postId, authorId, ...FEED_SCOPE },
    select: feedSelect,
  });
  if (!post) return null;

  const viewerRating = viewerId
    ? (
        await prisma.rating.findUnique({
          where: { postId_raterId: { postId, raterId: viewerId } },
          select: { value: true },
        })
      )?.value ?? null
    : null;

  return { ...post, viewerRating };
}

/**
 * Every platform announcement, newest first. Backs `/updates` and the admin panel.
 *
 * No cursor and no viewer rating: these are written by hand a few times a year, and
 * none of them is rateable. `take` is a ceiling rather than a page — when there are
 * ever more than a hundred of these, the page can grow a cursor.
 */
export async function fetchOfficialPosts(): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    where: { isOfficial: true, ...FEED_SCOPE },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: feedSelect,
  });
  return posts.map((post) => ({ ...post, viewerRating: null }));
}

/**
 * One post with its thread. Backs both `/api/comments` and the `/p/[id]` permalink.
 *
 * `isHidden` and `isStory` are selected explicitly because `feedSelect` does not
 * carry them — the feed applies `FEED_SCOPE` in its `where` instead, and a lookup
 * by id has no `where` to hide behind. Both are a flat null: a moderated post and
 * an expired story are equally "not a page", and saying which would leak the
 * difference.
 */
export async function fetchPostWithComments(postId: string, viewerId?: string | null) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      ...feedSelect,
      isHidden: true,
      isStory: true,
      comments: {
        orderBy: { createdAt: "asc" },
        take: 100,
        select: {
          id: true,
          body: true,
          isAI: true,
          createdAt: true,
          author: { select: commentAuthorSelect },
        },
      },
    },
  });
  if (!post || post.isHidden || post.isStory) return null;

  const viewerRating = viewerId
    ? (
        await prisma.rating.findUnique({
          where: { postId_raterId: { postId, raterId: viewerId } },
          select: { value: true },
        })
      )?.value ?? null
    : null;

  return { ...post, viewerRating };
}

// ---------------------------------------------------------------------------
// Serialisation for the client
// ---------------------------------------------------------------------------

/**
 * The avatar helpers live in `lib/avatar.ts` and are re-exported here.
 *
 * They were defined in this file first, and half of `lib` imports them from it.
 * They had to move out — this module now notifies people, and
 * `lib/notifications.ts` needs the same helper, which made the pair a cycle. The
 * re-export keeps every existing `from "./posts"` working.
 */
export { profileAssetUrl, resolveAvatarUrl } from "./avatar";
export type { AvatarSource } from "./avatar";

/**
 * Flatten a row into the plain shape components consume. Both the server-rendered
 * first page and the `fetch`-driven later pages go through here, so the props are
 * byte-identical and hydration stays quiet.
 */
export function toClientPost(post: FeedPost): ClientPost {
  const modDeleted = post.modDeletedAt !== null;
  return {
    id: post.id,
    kind: post.kind,
    caption: post.caption,
    tweetText: post.tweetText,
    // A tombstone hands out no media URL. `/api/media` would refuse it anyway —
    // it checks `isHidden` — but a dead <img> in a card is a broken icon, and the
    // point of the tombstone is that the post is gone, not that it failed to load.
    mediaUrl: post.storageKey && !modDeleted ? `/api/media/${post.storageKey}` : null,
    posterUrl:
      post.storageKey && post.posterKey && !modDeleted
        ? `/api/media/${post.storageKey}?poster=1`
        : null,
    mimeType: post.mimeType,
    width: post.width,
    height: post.height,
    durationMs: post.durationMs,
    archiveState: post.archiveState,
    ratingsSum: post.ratingsSum,
    ratingsCount: post.ratingsCount,
    average: post.ratingsCount > 0 ? post.ratingsSum / post.ratingsCount : null,
    commentsCount: post._count.comments,
    isOfficial: post.isOfficial,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: post.author.id,
      handle: post.author.handle,
      displayName: post.author.displayName,
      avatarUrl: resolveAvatarUrl(post.author),
      isAI: post.author.isAI,
      bakchodScore: post.author.bakchodScore,
    },
    viewerRating: post.viewerRating,
    modDeleted,
  };
}

export function toClientComment(comment: {
  id: string;
  body: string;
  isAI: boolean;
  createdAt: Date;
  author: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    isAI: boolean;
    theme?: { logoKey: string | null } | null;
  };
}): ClientComment {
  return {
    id: comment.id,
    body: comment.body,
    isAI: comment.isAI,
    createdAt: comment.createdAt.toISOString(),
    // Rebuilt field by field rather than spread: `theme` is a lookup detail and
    // has no business crossing to the browser.
    author: {
      handle: comment.author.handle,
      displayName: comment.author.displayName,
      avatarUrl: resolveAvatarUrl(comment.author),
      isAI: comment.author.isAI,
    },
  };
}

/**
 * What `toClientViewer` needs. Spelled out rather than `User & AvatarSource`,
 * because the pin lives on the same `theme` relation the avatar is resolved from and
 * intersecting two different shapes of one optional property is a type nobody can
 * read a field off.
 */
export interface ViewerSource extends AvatarSource {
  id: string;
  handle: string;
  displayName: string;
  isAdmin: boolean;
  theme?: { logoKey: string | null; pinnedPostId?: string | null } | null;
}

export function toClientViewer(user: ViewerSource | null): ClientViewer | null {
  if (!user) return null;
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: resolveAvatarUrl(user),
    isAdmin: user.isAdmin,
    pinnedPostId: user.theme?.pinnedPostId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * The three profile stats that are counts, scoped the way the page is.
 *
 * Deleting your own post is a hide, not a DELETE (see {@link deleteOwnPost}), so the
 * comments and ratings hanging off it are still rows. Counted raw they pad numbers
 * sitting directly beside `POSTS`, which does filter — a profile reading "0 posts,
 * 1 comment" is pointing the visitor at something they cannot open.
 *
 * `RATINGS` and the score are deliberately absent: those are `User.ratingsSum` and
 * `ratingsCount`, which are ratings *received* and are held past a delete on purpose.
 */
export const PROFILE_STAT_COUNTS = {
  posts: { where: FEED_SCOPE },
  comments: { where: { post: FEED_SCOPE } },
  ratings: { where: { post: FEED_SCOPE } },
} satisfies Prisma.UserCountOutputTypeSelect;

/**
 * One person, by handle. `cache`d because Next calls `generateMetadata` and the
 * page component separately and both need the same row — this way that is one
 * query per request rather than two.
 */
export const fetchProfile = cache(async (handle: string) => {
  return prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isAI: true,
      isAdmin: true,
      bakchodScore: true,
      ratingsSum: true,
      ratingsCount: true,
      createdAt: true,
      // No row means a stock profile. That is the AI account and anyone who has
      // not been to /settings/profile yet, so the null case is the common one.
      theme: {
        select: {
          tagline: true,
          bio: true,
          accent: true,
          welcomeHtml: true,
          welcomeEnabled: true,
          welcomeMs: true,
          welcomePreset: true,
          bannerKey: true,
          logoKey: true,
          links: true,
          pinnedPostId: true,
          visibility: true,
          storiesVisibility: true,
          showRatingsGiven: true,
          showJoinDate: true,
          allowComments: true,
        },
      },
      _count: {
        select: PROFILE_STAT_COUNTS,
      },
    },
  });
});

export type ProfileRow = NonNullable<Awaited<ReturnType<typeof fetchProfile>>>;
export type ProfileThemeRow = NonNullable<ProfileRow["theme"]>;

/**
 * Coerce the stored `links` JSON into the render shape.
 *
 * The column is validated by zod on every write, but a JSON column is still a
 * JSON column — a hand-edited row or an older shape should degrade to "no links"
 * rather than throw inside a server component.
 */
export function readThemeLinks(raw: Prisma.JsonValue | null): ClientProfileLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientProfileLink[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { label, url } = entry as Record<string, unknown>;
    if (typeof label === "string" && typeof url === "string" && label && url) {
      out.push({ label, url });
    }
  }
  return out.slice(0, limits.maxLinks);
}

/** The public slice of a theme. The welcome HTML itself never crosses to the client. */
export function toClientTheme(handle: string, theme: ProfileThemeRow): ClientProfileTheme {
  const hasIntro = theme.welcomeEnabled && Boolean(theme.welcomeHtml);
  return {
    tagline: theme.tagline,
    bio: theme.bio,
    accent: theme.accent,
    bannerUrl: profileAssetUrl(theme.bannerKey),
    logoUrl: profileAssetUrl(theme.logoKey),
    links: readThemeLinks(theme.links),
    welcome: hasIntro
      ? {
          url: `/api/welcome/${encodeURIComponent(handle)}`,
          autoDismissMs: theme.welcomeMs,
        }
      : null,
    allowComments: theme.allowComments,
  };
}

export function toClientProfile(
  row: ProfileRow,
  opts: { isOwner?: boolean } = {},
): ClientProfile {
  const theme = row.theme;
  const isOwner = opts.isOwner === true;
  // Owners always see their own stats — a switch that hid data from yourself
  // would just read as a bug.
  const showGiven = isOwner || theme?.showRatingsGiven !== false;
  const showJoined = isOwner || theme?.showJoinDate !== false;

  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
    isAI: row.isAI,
    isAdmin: row.isAdmin,
    // Left as stored. The AI's is structurally 0 because nothing can rate it,
    // and the profile page renders that fact rather than the number.
    bakchodScore: row.bakchodScore,
    ratingsCount: row.ratingsCount,
    average: row.ratingsCount > 0 ? row.ratingsSum / row.ratingsCount : null,
    postsCount: row._count.posts,
    commentsCount: row._count.comments,
    ratingsGiven: showGiven ? row._count.ratings : null,
    joinedAt: showJoined ? row.createdAt.toISOString() : null,
    theme: theme ? toClientTheme(row.handle, theme) : null,
  };
}

/**
 * Leaderboard. `isAI: false` is the load-bearing clause — the bot posts and
 * comments like everyone else but must never appear in the rankings.
 */
export async function fetchLeaderboard(take = 25): Promise<LeaderboardRow[]> {
  const rows = await prisma.user.findMany({
    where: { isAI: false, ratingsCount: { gt: 0 } },
    orderBy: [{ bakchodScore: "desc" }, { ratingsCount: "desc" }],
    take,
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      bakchodScore: true,
      ratingsCount: true,
      theme: { select: { logoKey: true } },
    },
  });

  // Mapped rather than returned raw so `logoKey` stops here: the client gets a
  // resolved URL, not the storage key behind it.
  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
    bakchodScore: row.bakchodScore,
    ratingsCount: row.ratingsCount,
  }));
}
