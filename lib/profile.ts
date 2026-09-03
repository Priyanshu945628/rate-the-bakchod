import "server-only";

/**
 * Reads and writes for profile customisation.
 *
 * The privacy helpers in here are the enforcement point, not the UI. A visitor
 * who is not allowed to see a profile gets a 403 or a stripped page from the
 * server; nothing is merely hidden with CSS, and no field they should not have
 * is serialised into the RSC payload for them to dig out of dev tools.
 */

import { Prisma, type ProfileAssetSlot, type User } from "@prisma/client";
import { limits } from "./config";
import { prisma } from "./prisma";
import { PostServiceError, FEED_SCOPE, profileAssetUrl, readThemeLinks } from "./posts";
import { maxEdgeForSlot, normalizeProfileImage } from "./media/profile-image";
import { newStorageKey, toBytes } from "./media/store";
import { ProfilePatchSchema } from "./profile-schema";
import { renameIdentity, RenameError } from "./identity";
import type { OwnerThemeSettings, VisibilityName } from "./types";

/** What a profile looks like before anyone has touched the settings page. */
export const DEFAULT_THEME: OwnerThemeSettings = {
  tagline: null,
  bio: null,
  accent: null,
  welcomeHtml: null,
  welcomeEnabled: true,
  welcomeMs: 4000,
  welcomePreset: null,
  bannerUrl: null,
  logoUrl: null,
  links: [],
  pinnedPostId: null,
  visibility: "PUBLIC",
  storiesVisibility: "PUBLIC",
  showRatingsGiven: true,
  showJoinDate: true,
  allowComments: true,
  dmPolicy: "EVERYONE",
};

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * Whether `viewerId` may see the decorated profile at all.
 *
 * Note what this does *not* gate: the bakchod score and the leaderboard. Being
 * rated in public is the product — an opt-out would let exactly the biggest
 * bakchods duck the ranking — so privacy here covers decoration, stories,
 * comments and two secondary stats, never the score.
 */
export function visibilityAllows(
  setting: VisibilityName | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  if (setting !== "SIGNED_IN") return true;
  return Boolean(viewerId);
}

/**
 * The privacy settings for one handle, without loading the whole profile.
 *
 * Used by the API routes, which need to answer "may this request proceed?" before
 * doing any work. Missing row means every default, which is fully public.
 */
export async function fetchPrivacy(handle: string) {
  const row = await prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      theme: {
        select: { visibility: true, storiesVisibility: true, allowComments: true },
      },
    },
  });
  if (!row) return null;
  return {
    ownerId: row.id,
    visibility: row.theme?.visibility ?? "PUBLIC",
    storiesVisibility: row.theme?.storiesVisibility ?? "PUBLIC",
    allowComments: row.theme?.allowComments ?? true,
  };
}

/** Whether comments are open on a given post, by the post's author's setting. */
export async function commentsAllowedOnPost(postId: string): Promise<boolean> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { author: { select: { theme: { select: { allowComments: true } } } } },
  });
  return post?.author.theme?.allowComments ?? true;
}

// ---------------------------------------------------------------------------
// Reading, for the owner
// ---------------------------------------------------------------------------

export async function fetchOwnerTheme(userId: string): Promise<OwnerThemeSettings> {
  const row = await prisma.profileTheme.findUnique({ where: { userId } });
  if (!row) return DEFAULT_THEME;

  return {
    tagline: row.tagline,
    bio: row.bio,
    accent: row.accent,
    welcomeHtml: row.welcomeHtml,
    welcomeEnabled: row.welcomeEnabled,
    welcomeMs: row.welcomeMs,
    welcomePreset: row.welcomePreset,
    bannerUrl: profileAssetUrl(row.bannerKey),
    logoUrl: profileAssetUrl(row.logoKey),
    links: readThemeLinks(row.links),
    pinnedPostId: row.pinnedPostId,
    visibility: row.visibility,
    storiesVisibility: row.storiesVisibility,
    showRatingsGiven: row.showRatingsGiven,
    showJoinDate: row.showJoinDate,
    allowComments: row.allowComments,
    dmPolicy: row.dmPolicy,
  };
}

/** The stored welcome HTML, or null. Read by the sandboxed-document route only. */
export async function fetchWelcomeHtml(handle: string) {
  const row = await prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      displayName: true,
      theme: {
        select: {
          welcomeHtml: true,
          welcomeEnabled: true,
          accent: true,
          visibility: true,
        },
      },
    },
  });
  if (!row?.theme) return null;
  return {
    ownerId: row.id,
    displayName: row.displayName,
    html: row.theme.welcomeHtml,
    enabled: row.theme.welcomeEnabled,
    accent: row.theme.accent,
    visibility: row.theme.visibility,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type ThemeWrite = Partial<Omit<Prisma.ProfileThemeUncheckedCreateInput, "userId">>;

/**
 * Apply a validated patch.
 *
 * An absent key means "leave it alone" and an explicit `null` means "clear it",
 * which is why this builds the write from `in` checks rather than spreading the
 * parsed object — spreading would turn "didn't mention the bio" into "wipe the
 * bio" the moment the form posts one section at a time.
 *
 * Identity fields (displayName, handle) travel inside the same body but are not
 * theme fields: they are split off and routed to `renameIdentity`, which owns the
 * transaction, the cooldown and the old-handle reservation. A rename that fails
 * aborts the whole save, so a refused handle never half-applies a theme change.
 */
export async function saveTheme(
  user: User,
  raw: unknown,
): Promise<{ theme: OwnerThemeSettings; identity: { handle: string; displayName: string } }> {
  const parsed = ProfilePatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PostServiceError(firstIssue(parsed.error), 400);
  }

  // Rest-destructuring, not a rebuilt literal: listing the theme keys out would
  // make every one of them *present* as `undefined`, and the `in` checks below
  // would then read "didn't mention the bio" as "wipe the bio".
  const { displayName, handle, ...patch } = parsed.data;

  let identity = { handle: user.handle, displayName: user.displayName };
  if (displayName !== undefined || handle !== undefined) {
    try {
      const renamed = await renameIdentity(user, { displayName, handle });
      identity = { handle: renamed.handle, displayName: renamed.displayName };
    } catch (cause) {
      if (cause instanceof RenameError) {
        throw new PostServiceError(cause.message, cause.status);
      }
      throw cause;
    }
  }

  const data: ThemeWrite = {};

  if ("tagline" in patch) data.tagline = patch.tagline;
  if ("bio" in patch) data.bio = patch.bio;
  if ("accent" in patch) data.accent = patch.accent;
  if ("welcomeHtml" in patch) data.welcomeHtml = patch.welcomeHtml;
  if ("welcomeEnabled" in patch) data.welcomeEnabled = patch.welcomeEnabled;
  if ("welcomeMs" in patch) data.welcomeMs = patch.welcomeMs;
  if ("welcomePreset" in patch) data.welcomePreset = patch.welcomePreset;
  if ("visibility" in patch) data.visibility = patch.visibility;
  if ("storiesVisibility" in patch) data.storiesVisibility = patch.storiesVisibility;
  if ("showRatingsGiven" in patch) data.showRatingsGiven = patch.showRatingsGiven;
  if ("showJoinDate" in patch) data.showJoinDate = patch.showJoinDate;
  if ("allowComments" in patch) data.allowComments = patch.allowComments;
  if ("dmPolicy" in patch) data.dmPolicy = patch.dmPolicy;

  // A nullable Json column cannot take a bare `null` in Prisma — that would be
  // ambiguous with JSON's own null — so clearing is spelled out.
  if ("links" in patch) {
    data.links = patch.links === null ? Prisma.DbNull : patch.links;
  }

  if ("pinnedPostId" in patch) {
    data.pinnedPostId = patch.pinnedPostId
      ? await validatePinnedPost(user.id, patch.pinnedPostId)
      : null;
  }

  await prisma.profileTheme.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  const theme = await fetchOwnerTheme(user.id);
  return { theme, identity };
}

/**
 * A pin has to be your own, visible, and a real feed post. Otherwise the field
 * would be a way to stick somebody else's post — or a hidden one — at the top of
 * your profile.
 */
async function validatePinnedPost(userId: string, postId: string): Promise<string> {
  const post = await prisma.post.findFirst({
    where: { id: postId, authorId: userId, ...FEED_SCOPE },
    select: { id: true },
  });
  if (!post) {
    throw new PostServiceError("You can only pin one of your own visible posts.", 400);
  }
  return post.id;
}

function firstIssue(error: { issues: Array<{ message: string; path: Array<string | number | symbol> }> }): string {
  const issue = error.issues[0];
  if (!issue) return "That does not look right.";
  const where = issue.path.length > 0 ? `${String(issue.path[0])}: ` : "";
  return `${where}${issue.message}`;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface StoredAsset {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Normalise and store a banner, logo or highlight cover.
 *
 * The bytes go into Postgres rather than through the encrypted archive path, for
 * two reasons: decoration does not belong in a permanent, undeletable public
 * library, and the archive queue is keyed to a `Post`. The tradeoff is DB size —
 * roughly 300 MB per thousand themed users at the 400 KB cap — which is fine now
 * and is one adapter swap away from an object store later, because every read
 * goes through a single route.
 *
 * For BANNER and LOGO the theme pointer is moved and the previous asset deleted in
 * the same transaction, so replacing an image cannot leave an orphan row. A
 * HIGHLIGHT_COVER is returned unattached — the highlight route owns that pointer.
 */
export async function putProfileAsset(
  user: User,
  slot: ProfileAssetSlot,
  file: Buffer,
): Promise<StoredAsset> {
  const image = await normalizeProfileImage(file, maxEdgeForSlot(slot));
  const key = newStorageKey();

  const previous =
    slot === "HIGHLIGHT_COVER"
      ? null
      : (
          await prisma.profileTheme.findUnique({
            where: { userId: user.id },
            select: { bannerKey: true, logoKey: true },
          })
        )?.[slot === "BANNER" ? "bannerKey" : "logoKey"] ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.profileAsset.create({
      data: {
        key,
        ownerId: user.id,
        slot,
        mimeType: image.mimeType,
        data: toBytes(image.data),
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      },
    });

    if (slot !== "HIGHLIGHT_COVER") {
      const field = slot === "BANNER" ? "bannerKey" : "logoKey";
      await tx.profileTheme.upsert({
        where: { userId: user.id },
        create: { userId: user.id, [field]: key },
        update: { [field]: key },
      });
      if (previous) {
        await tx.profileAsset.deleteMany({ where: { key: previous, ownerId: user.id } });
      }
    }
  });

  return { key, url: `/api/profile-asset/${key}`, width: image.width, height: image.height, bytes: image.bytes };
}

/** Clear a banner or logo. Ownership is part of the `where`, not a prior check. */
export async function clearProfileAsset(
  user: User,
  slot: "BANNER" | "LOGO",
): Promise<void> {
  const field = slot === "BANNER" ? "bannerKey" : "logoKey";
  const theme = await prisma.profileTheme.findUnique({
    where: { userId: user.id },
    select: { bannerKey: true, logoKey: true },
  });
  const key = theme?.[field] ?? null;
  if (!key) return;

  await prisma.$transaction([
    prisma.profileTheme.update({ where: { userId: user.id }, data: { [field]: null } }),
    prisma.profileAsset.deleteMany({ where: { key, ownerId: user.id } }),
  ]);
}

export async function readProfileAsset(key: string) {
  return prisma.profileAsset.findUnique({
    where: { key },
    select: { mimeType: true, data: true, bytes: true },
  });
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Strip a profile back to stock. The admin escape hatch for a theme that is
 * abusive rather than merely ugly — a flashing intro, a slur in a tagline.
 *
 * Deleting the row also drops the welcome HTML, the links and the pin; the asset
 * rows go with it because they cascade off `User`, not off the theme, so they are
 * removed explicitly here.
 */
export async function wipeTheme(handle: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { handle }, select: { id: true } });
  if (!user) return false;

  await prisma.$transaction([
    prisma.profileAsset.deleteMany({ where: { ownerId: user.id, slot: { in: ["BANNER", "LOGO"] } } }),
    prisma.profileTheme.deleteMany({ where: { userId: user.id } }),
  ]);
  return true;
}

/** Re-exported so callers do not need two imports to render a link row. */
export { readThemeLinks, profileAssetUrl };
export const MAX_LINKS = limits.maxLinks;
