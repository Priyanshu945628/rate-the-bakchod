-- Polls, seen-posts, and the bot's poll share.
--
-- Paste this whole thing into the Supabase SQL editor. It is idempotent: every
-- statement is guarded, so running it twice is a no-op rather than an error, and
-- running it against a database that already has half of this applies the rest.
--
-- Four things:
--   1. POLL on the PostKind enum          — a poll is a kind of post, not a table.
--   2. PollOption / PollVote              — the options, and one answer per person.
--   3. PostView                           — which posts a signed-in viewer has seen.
--   4. BotSetting.pollPercent             — how often the house account asks one.
--
-- Nothing here touches an existing row's data. The one write is the DEFAULT on the
-- new BotSetting column, which is the same 30 the code falls back to anyway.

-- ---------------------------------------------------------------------------
-- 1. PostKind gets POLL
-- ---------------------------------------------------------------------------
-- `IF NOT EXISTS` on an enum value needs PG 12+; Supabase is well past that.
-- Adding a value cannot be done inside a transaction block on older versions,
-- so this stays the first statement and on its own.
ALTER TYPE "PostKind" ADD VALUE IF NOT EXISTS 'POLL';

-- ---------------------------------------------------------------------------
-- 2. Polls
-- ---------------------------------------------------------------------------
-- The options on a poll, in the order the author typed them. `votesCount` is a
-- denormalised tally kept in the same transaction as the vote, because the card
-- shows every option's share on every render.
CREATE TABLE IF NOT EXISTS "PollOption" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL,
    "votesCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- One person's answer. `postId` rides alongside `optionId` so the one-vote rule
-- below is a database constraint rather than a join the vote path has to remember.
CREATE TABLE IF NOT EXISTS "PollVote" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PollOption_postId_position_key"
    ON "PollOption"("postId", "position");
CREATE INDEX IF NOT EXISTS "PollOption_postId_idx" ON "PollOption"("postId");

-- The one-vote rule. Moving a vote is an UPDATE of this row, not a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "PollVote_postId_voterId_key"
    ON "PollVote"("postId", "voterId");
CREATE INDEX IF NOT EXISTS "PollVote_optionId_idx" ON "PollVote"("optionId");

-- ---------------------------------------------------------------------------
-- 3. Seen posts
-- ---------------------------------------------------------------------------
-- No surrogate id, like "Follow": nothing points at one of these and the pair is
-- the fact. `seenAt` is what lets the For You ranker order the already-seen ones
-- by how long ago, instead of leaving them an unordered pile.
CREATE TABLE IF NOT EXISTS "PostView" (
    "postId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostView_pkey" PRIMARY KEY ("postId", "viewerId")
);

CREATE INDEX IF NOT EXISTS "PostView_viewerId_seenAt_idx"
    ON "PostView"("viewerId", "seenAt" DESC);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
-- ADD CONSTRAINT has no IF NOT EXISTS, so each one is added only when absent.
-- Every reference cascades: deleting a post takes its options and votes with it,
-- and deleting a user takes their votes and their seen-rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollOption_postId_fkey') THEN
    ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollVote_postId_fkey') THEN
    ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollVote_optionId_fkey') THEN
    ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey"
      FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollVote_voterId_fkey') THEN
    ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_voterId_fkey"
      FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostView_postId_fkey') THEN
    ALTER TABLE "PostView" ADD CONSTRAINT "PostView_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostView_viewerId_fkey') THEN
    ALTER TABLE "PostView" ADD CONSTRAINT "PostView_viewerId_fkey"
      FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Check constraints
-- ---------------------------------------------------------------------------
-- Invariants that are cheaper here than in every code path that writes. A tally
-- that has gone negative means the vote path lost a decrement, and it must not be
-- allowed to sit in the table looking like data.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollOption_votes_nonneg') THEN
    ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_votes_nonneg"
      CHECK ("votesCount" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollOption_label_not_blank') THEN
    ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_label_not_blank"
      CHECK (char_length(btrim("label")) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PollOption_position_nonneg') THEN
    ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_position_nonneg"
      CHECK ("position" >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Every table is locked down; Prisma connects as the owner, which is exempt, so
-- the app keeps full access while any direct client reads nothing. On these three
-- that matters more than most: PollVote and PostView are a record of what one
-- person answered and what they have been looking at.
ALTER TABLE "PollOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollVote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostView" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. The bot's poll share
-- ---------------------------------------------------------------------------
-- Rolled after the card roll, so this is a share of the posts that are not cards.
-- The default matches BOT_DEFAULTS.pollPercent, which is what the bot uses when
-- this row has never been saved from the panel.
ALTER TABLE "BotSetting"
  ADD COLUMN IF NOT EXISTS "pollPercent" INTEGER NOT NULL DEFAULT 30;
