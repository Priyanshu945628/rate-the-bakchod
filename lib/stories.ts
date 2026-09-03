import "server-only";

/**
 * Stories and highlights.
 *
 * A story is a `Post` row with `isStory = true` and an expiry. That is the whole
 * trick: it inherits the entire upload path unchanged — normalised, EXIF-stripped,
 * encrypted under its own DEK, archived, crypto-shreddable, servable through
 * `/api/media/[key]`, reportable and hideable. The archive worker needed no change
 * at all, because it already takes a post id.
 *
 * The price is that "a post on the feed" now needs saying explicitly. That is
 * `FEED_SCOPE` in `lib/posts.ts`, used at every such call site.
 */

import { Prisma, type User } from "@prisma/client";
import { limits } from "./config";
import { prisma } from "./prisma";
import { createPost, PostServiceError, profileAssetUrl, resolveAvatarUrl } from "./posts";
import { notify } from "./notifications";
import { HighlightTitleSchema } from "./profile-schema";
import { liveStoryFilter } from "./story-window";
import type {
  ClientAuthor,
  ClientHighlight,
  ClientStory,
  ClientStoryTray,
} from "./types";

/** Bounded so a single request cannot pull the whole story table into memory. */
const TRAY_STORY_LIMIT = 240;
const STORIES_PER_AUTHOR = 20;

const storySelect = {
  id: true,
  kind: true,
  caption: true,
  storageKey: true,
  posterKey: true,
  mimeType: true,
  width: true,
  height: true,
  durationMs: true,
  createdAt: true,
  storyExpiresAt: true,
  highlightId: true,
  authorId: true,
  author: {
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isAI: true,
      bakchodScore: true,
      theme: { select: { logoKey: true } },
    },
  },
  _count: { select: { storyViews: true } },
} satisfies Prisma.PostSelect;

type StoryRow = Prisma.PostGetPayload<{ select: typeof storySelect }>;

function toClientAuthor(author: StoryRow["author"]): ClientAuthor {
  return {
    id: author.id,
    handle: author.handle,
    displayName: author.displayName,
    avatarUrl: resolveAvatarUrl(author),
    isAI: author.isAI,
    bakchodScore: author.bakchodScore,
  };
}

function toClientStory(
  row: StoryRow,
  opts: { seen: boolean; isOwner: boolean },
): ClientStory {
  return {
    id: row.id,
    kind: row.kind,
    caption: row.caption,
    mediaUrl: row.storageKey ? `/api/media/${row.storageKey}` : null,
    posterUrl:
      row.storageKey && row.posterKey ? `/api/media/${row.storageKey}?poster=1` : null,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    // A highlighted story has outlived its clock, so reporting a countdown for it
    // would be a lie.
    expiresAt: row.highlightId ? null : (row.storyExpiresAt?.toISOString() ?? null),
    seen: opts.seen,
    // "Seen by" is for the author only. Everyone else gets null, and the number
    // never reaches their browser at all.
    viewsCount: opts.isOwner ? row._count.storyViews : null,
  };
}

/** Which post ids this viewer has already opened. Empty when signed out. */
async function seenIds(viewerId: string | null, postIds: string[]): Promise<Set<string>> {
  if (!viewerId || postIds.length === 0) return new Set();
  const rows = await prisma.storyView.findMany({
    where: { viewerId, postId: { in: postIds } },
    select: { postId: true },
  });
  return new Set(rows.map((r) => r.postId));
}

/**
 * Only authors whose stories this viewer is allowed to see, or null for "everyone".
 *
 * A signed-out visitor is excluded from `SIGNED_IN` trays here, in the query,
 * rather than being filtered out afterwards — that way the rows never exist in
 * the response to be leaked by a later refactor.
 *
 * It returns the `author` clause on its own, not a whole `where`, so a caller that
 * already filters on `author` can merge the two conditions into one object. Spreading
 * a second `author` key beside an existing one would silently drop whichever came
 * first, and the one that vanished would be this privacy check.
 */
function storyAudienceFilter(viewerId: string | null): Prisma.UserWhereInput | null {
  if (viewerId) return null;
  return {
    OR: [{ theme: { is: null } }, { theme: { storiesVisibility: "PUBLIC" } }],
  };
}

function buildTrays(
  rows: StoryRow[],
  seen: Set<string>,
  viewerId: string | null,
): ClientStoryTray[] {
  const byAuthor = new Map<string, ClientStoryTray>();

  for (const row of rows) {
    let tray = byAuthor.get(row.authorId);
    if (!tray) {
      tray = {
        author: toClientAuthor(row.author),
        stories: [],
        hasUnseen: false,
      };
      byAuthor.set(row.authorId, tray);
    }
    if (tray.stories.length >= STORIES_PER_AUTHOR) continue;

    const isSeen = seen.has(row.id);
    tray.stories.push(
      toClientStory(row, { seen: isSeen, isOwner: viewerId === row.authorId }),
    );
    if (!isSeen) tray.hasUnseen = true;
  }

  const trays = [...byAuthor.values()].filter((t) => t.stories.length > 0);

  // Your own tray first, then anything unseen, then most recent. Same ordering
  // instinct every story tray has: the thing you have not looked at is on the left.
  return trays.sort((a, b) => {
    const mine = Number(b.author.id === viewerId) - Number(a.author.id === viewerId);
    if (mine !== 0) return mine;
    const unseen = Number(b.hasUnseen) - Number(a.hasUnseen);
    if (unseen !== 0) return unseen;
    return latest(b).localeCompare(latest(a));
  });
}

function latest(tray: ClientStoryTray): string {
  return tray.stories[tray.stories.length - 1]?.createdAt ?? "";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every live tray, for the top of the home feed. */
export async function fetchStoryTrays(
  viewerId: string | null,
  now: Date = new Date(),
): Promise<ClientStoryTray[]> {
  const audience = storyAudienceFilter(viewerId);

  const rows = await prisma.post.findMany({
    where: { ...liveStoryFilter(now), ...(audience ? { author: audience } : {}) },
    select: storySelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: TRAY_STORY_LIMIT,
  });

  const seen = await seenIds(viewerId, rows.map((r) => r.id));
  return buildTrays(rows, seen, viewerId);
}

/** One person's live stories, for the ring on their profile. */
export async function fetchAuthorStories(
  handle: string,
  viewerId: string | null,
  now: Date = new Date(),
): Promise<ClientStoryTray | null> {
  // The audience check is a condition on `author`, and so is the handle lookup, so
  // the two are merged into one clause. Two `author` keys in the same object would
  // mean the second silently wins and the privacy check would vanish.
  const audience = storyAudienceFilter(viewerId);

  const rows = await prisma.post.findMany({
    where: { ...liveStoryFilter(now), author: { handle, ...audience } },
    select: storySelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: STORIES_PER_AUTHOR,
  });
  if (rows.length === 0) return null;

  const seen = await seenIds(viewerId, rows.map((r) => r.id));
  return buildTrays(rows, seen, viewerId)[0] ?? null;
}

export async function fetchHighlights(ownerId: string): Promise<ClientHighlight[]> {
  const rows = await prisma.highlight.findMany({
    where: { ownerId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      coverKey: true,
      _count: { select: { posts: { where: { isHidden: false } } } },
    },
  });

  return rows.map((h) => ({
    id: h.id,
    title: h.title,
    coverUrl: profileAssetUrl(h.coverKey),
    count: h._count.posts,
  }));
}

/**
 * Who owns a highlight, and how they display.
 *
 * A visitor opening someone else's highlight has only its id in hand, so the route
 * needs a way to get from that id to the owner's `storiesVisibility` before it
 * hands any stories over. Returning the author for the viewer's header too, so the
 * overlay does not need a second round trip.
 */
export async function fetchHighlightOwner(highlightId: string) {
  const row = await prisma.highlight.findUnique({
    where: { id: highlightId },
    select: {
      id: true,
      title: true,
      owner: {
        select: {
          id: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          isAI: true,
          bakchodScore: true,
          theme: { select: { storiesVisibility: true, logoKey: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    author: {
      id: row.owner.id,
      handle: row.owner.handle,
      displayName: row.owner.displayName,
      avatarUrl: resolveAvatarUrl(row.owner),
      isAI: row.owner.isAI,
      bakchodScore: row.owner.bakchodScore,
    },
    storiesVisibility: row.owner.theme?.storiesVisibility ?? "PUBLIC",
  };
}

export async function fetchHighlightStories(
  highlightId: string,
  viewerId: string | null,
): Promise<ClientStory[]> {
  const rows = await prisma.post.findMany({
    where: { highlightId, isHidden: false, isStory: true },
    select: storySelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const seen = await seenIds(viewerId, rows.map((r) => r.id));
  return rows.map((r) =>
    toClientStory(r, { seen: seen.has(r.id), isOwner: viewerId === r.authorId }),
  );
}

/**
 * Everything the owner has ever posted as a story, expired included.
 *
 * This is the counterpart to expiry being non-destructive: nothing is swept away
 * behind your back, so there has to be somewhere you can go and see it.
 */
export async function fetchStoryArchive(ownerId: string, now: Date = new Date()) {
  const rows = await prisma.post.findMany({
    where: { authorId: ownerId, isStory: true, isHidden: false },
    select: { ...storySelect, highlight: { select: { id: true, title: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 120,
  });

  return rows.map((row) => ({
    story: toClientStory(row, { seen: true, isOwner: true }),
    live: row.highlightId !== null || (row.storyExpiresAt?.getTime() ?? 0) > now.getTime(),
    highlight: row.highlight ? { id: row.highlight.id, title: row.highlight.title } : null,
  }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createStory(author: User, file: Buffer, caption?: string | null) {
  return createPost({ author, file, caption, story: true });
}

/**
 * The story that was just posted, shaped exactly as the tray holds it.
 *
 * Handed straight back from `POST /api/stories` so the tray can put the ring on
 * screen itself. Without it the only way to see your own story is a
 * `router.refresh()`, which reloads the whole feed to add one 58px circle.
 *
 * `seen: false` because you have posted it, not watched it — the ring stays lit
 * until you open your own run, which is what every other tray here does too.
 */
export async function fetchPostedStory(
  id: string,
  ownerId: string,
): Promise<{ author: ClientAuthor; story: ClientStory } | null> {
  const row = await prisma.post.findFirst({
    where: { id, authorId: ownerId, isStory: true },
    select: storySelect,
  });
  if (!row) return null;
  return {
    author: toClientAuthor(row.author),
    story: toClientStory(row, { seen: false, isOwner: true }),
  };
}

/**
 * Record that `viewer` opened a story.
 *
 * Idempotent — a re-view is not a new view, so the count stays honest. The author
 * looking at their own story is not recorded either; "seen by 1" that is always
 * you would be noise.
 */
export async function markStorySeen(viewer: User, postId: string): Promise<void> {
  const story = await prisma.post.findFirst({
    where: { id: postId, isStory: true, isHidden: false },
    select: { id: true, authorId: true },
  });
  if (!story) throw new PostServiceError("That story is gone.", 404);
  if (story.authorId === viewer.id) return;

  try {
    await prisma.storyView.create({ data: { postId, viewerId: viewer.id } });
  } catch (err) {
    // P2002 is the unique constraint doing its job on a concurrent double-open.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
    // A re-open is not news either. Returning here rather than falling through is
    // what stops one person scrubbing a story back and forth from bumping the
    // author's bell every time.
    return;
  }

  void notify({
    userId: story.authorId,
    actorId: viewer.id,
    type: "STORY_VIEW",
    postId,
  });
}

/**
 * Delete your own story. This is the existing crypto-shred: Internet Archive has
 * no delete, so destroying the wrapped key *is* the deletion — the archived
 * ciphertext can never be read again.
 */
export async function deleteStory(owner: User, postId: string): Promise<void> {
  const story = await prisma.post.findFirst({
    where: { id: postId, authorId: owner.id, isStory: true },
    select: { id: true },
  });
  if (!story) throw new PostServiceError("That is not your story.", 404);

  await prisma.post.update({
    where: { id: postId },
    data: {
      isHidden: true,
      hiddenAt: new Date(),
      highlightId: null,
      wrappedKey: null,
      keyIv: null,
      keyTag: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export async function createHighlight(owner: User, rawTitle: unknown) {
  const parsed = HighlightTitleSchema.safeParse(rawTitle);
  if (!parsed.success) {
    throw new PostServiceError(parsed.error.issues[0]?.message ?? "Bad title.", 400);
  }

  const existing = await prisma.highlight.count({ where: { ownerId: owner.id } });
  if (existing >= limits.maxHighlights) {
    throw new PostServiceError(`You can have at most ${limits.maxHighlights} highlights.`, 400);
  }

  return prisma.highlight.create({
    data: { ownerId: owner.id, title: parsed.data, sortOrder: existing },
    select: { id: true, title: true },
  });
}

export async function renameHighlight(owner: User, id: string, rawTitle: unknown) {
  const parsed = HighlightTitleSchema.safeParse(rawTitle);
  if (!parsed.success) {
    throw new PostServiceError(parsed.error.issues[0]?.message ?? "Bad title.", 400);
  }
  // Ownership lives in the `where`, so a wrong id is a no-op rather than an edit.
  const { count } = await prisma.highlight.updateMany({
    where: { id, ownerId: owner.id },
    data: { title: parsed.data },
  });
  if (count === 0) throw new PostServiceError("That is not your highlight.", 404);
}

/**
 * Delete a highlight. The stories inside survive — `Post.highlightId` is
 * `ON DELETE SET NULL` — so they fall back to being ordinary expired stories in
 * the owner's archive rather than being destroyed as a side effect.
 */
export async function deleteHighlight(owner: User, id: string): Promise<void> {
  const highlight = await prisma.highlight.findFirst({
    where: { id, ownerId: owner.id },
    select: { id: true, coverKey: true },
  });
  if (!highlight) throw new PostServiceError("That is not your highlight.", 404);

  await prisma.$transaction([
    prisma.highlight.delete({ where: { id } }),
    ...(highlight.coverKey
      ? [prisma.profileAsset.deleteMany({ where: { key: highlight.coverKey, ownerId: owner.id } })]
      : []),
  ]);
}

export async function setHighlightCover(
  owner: User,
  id: string,
  assetKey: string,
): Promise<void> {
  const [highlight, asset] = await Promise.all([
    prisma.highlight.findFirst({
      where: { id, ownerId: owner.id },
      select: { id: true, coverKey: true },
    }),
    prisma.profileAsset.findFirst({
      where: { key: assetKey, ownerId: owner.id, slot: "HIGHLIGHT_COVER" },
      select: { key: true },
    }),
  ]);
  if (!highlight) throw new PostServiceError("That is not your highlight.", 404);
  if (!asset) throw new PostServiceError("That image is not yours.", 400);

  await prisma.$transaction([
    prisma.highlight.update({ where: { id }, data: { coverKey: asset.key } }),
    ...(highlight.coverKey && highlight.coverKey !== asset.key
      ? [prisma.profileAsset.deleteMany({ where: { key: highlight.coverKey, ownerId: owner.id } })]
      : []),
  ]);
}

/** Promote a story into a highlight, which is what makes it survive its expiry. */
export async function addStoryToHighlight(
  owner: User,
  postId: string,
  highlightId: string,
): Promise<void> {
  const highlight = await prisma.highlight.findFirst({
    where: { id: highlightId, ownerId: owner.id },
    select: { id: true },
  });
  if (!highlight) throw new PostServiceError("That is not your highlight.", 404);

  const { count } = await prisma.post.updateMany({
    where: { id: postId, authorId: owner.id, isStory: true, isHidden: false },
    data: { highlightId: highlight.id },
  });
  if (count === 0) throw new PostServiceError("That is not your story.", 404);
}

export async function removeStoryFromHighlight(owner: User, postId: string): Promise<void> {
  const { count } = await prisma.post.updateMany({
    where: { id: postId, authorId: owner.id, isStory: true },
    data: { highlightId: null },
  });
  if (count === 0) throw new PostServiceError("That is not your story.", 404);
}
