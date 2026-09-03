-- Profile customization, privacy, and stories.

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'SIGNED_IN');

-- CreateEnum
CREATE TYPE "ProfileAssetSlot" AS ENUM ('BANNER', 'LOGO', 'HIGHLIGHT_COVER');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "isStory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "highlightId" TEXT;

-- CreateTable
CREATE TABLE "ProfileTheme" (
    "userId" TEXT NOT NULL,
    "tagline" VARCHAR(80),
    "bio" VARCHAR(300),
    "accent" VARCHAR(7),
    "welcomeHtml" VARCHAR(16384),
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeMs" INTEGER NOT NULL DEFAULT 4000,
    "welcomePreset" TEXT,
    "bannerKey" TEXT,
    "logoKey" TEXT,
    "links" JSONB,
    "pinnedPostId" TEXT,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "storiesVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "showRatingsGiven" BOOLEAN NOT NULL DEFAULT true,
    "showJoinDate" BOOLEAN NOT NULL DEFAULT true,
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileTheme_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ProfileAsset" (
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slot" "ProfileAssetSlot" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileAsset_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "coverKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryView" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_isStory_storyExpiresAt_idx" ON "Post"("isStory", "storyExpiresAt");

-- CreateIndex
CREATE INDEX "Post_authorId_isStory_storyExpiresAt_idx" ON "Post"("authorId", "isStory", "storyExpiresAt");

-- CreateIndex
CREATE INDEX "Post_highlightId_idx" ON "Post"("highlightId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileTheme_pinnedPostId_key" ON "ProfileTheme"("pinnedPostId");

-- CreateIndex
CREATE INDEX "ProfileAsset_ownerId_slot_idx" ON "ProfileAsset"("ownerId", "slot");

-- CreateIndex
CREATE INDEX "Highlight_ownerId_sortOrder_idx" ON "Highlight"("ownerId", "sortOrder");

-- CreateIndex
CREATE INDEX "StoryView_postId_idx" ON "StoryView"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryView_postId_viewerId_key" ON "StoryView"("postId", "viewerId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileTheme" ADD CONSTRAINT "ProfileTheme_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileTheme" ADD CONSTRAINT "ProfileTheme_pinnedPostId_fkey" FOREIGN KEY ("pinnedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAsset" ADD CONSTRAINT "ProfileAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written, as in the init migration: Prisma's schema language cannot
-- express any of this, so it lives here to survive future `migrate diff` runs.
-- ─────────────────────────────────────────────────────────────────────────────

-- A story is a Post with an expiry; a non-story must never carry one. Enforcing
-- the pairing here means a bug in the API cannot produce a row that the feed and
-- the story tray disagree about.
ALTER TABLE "Post" ADD CONSTRAINT "Post_story_expiry_pairing"
  CHECK (("isStory" AND "storyExpiresAt" IS NOT NULL)
      OR (NOT "isStory" AND "storyExpiresAt" IS NULL));

-- Only stories belong to highlights.
ALTER TABLE "Post" ADD CONSTRAINT "Post_highlight_story_only"
  CHECK ("highlightId" IS NULL OR "isStory");

-- Flat hex only, lowercase or upper. The API validates it too; this stops a bug
-- there from putting `red; background-image: linear-gradient(...)` into a style
-- attribute. No gradients is a hard rule for this app.
ALTER TABLE "ProfileTheme" ADD CONSTRAINT "ProfileTheme_accent_hex"
  CHECK ("accent" IS NULL OR "accent" ~ '^#[0-9a-fA-F]{6}$');

-- The welcome splash auto-dismiss, in ms. 0 means "wait for the visitor"; the
-- ceiling stops a profile pinning someone on a splash screen for a minute.
ALTER TABLE "ProfileTheme" ADD CONSTRAINT "ProfileTheme_welcome_ms_range"
  CHECK ("welcomeMs" BETWEEN 0 AND 20000);

-- Deny-all row level security on the new tables, matching the init migration.
-- Prisma connects as the table owner and is exempt (FORCE ROW LEVEL SECURITY is
-- deliberately not set); what this blocks is the `anon` / `authenticated` roles
-- behind the publishable key, so a leaked browser key reads nothing.
ALTER TABLE "ProfileTheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfileAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Highlight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoryView" ENABLE ROW LEVEL SECURITY;
