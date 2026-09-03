import "server-only";

/**
 * The AI bakchod.
 *
 * A resident bot that posts its own bakchodi and roasts whatever shows up on the
 * feed. Two hard rules shape this file:
 *
 *  1. **It is never scored.** The bot's account carries `isAI: true`; rating its
 *     posts is rejected in the service layer and every leaderboard query filters
 *     it out. Its points are never calculated, anywhere.
 *  2. **It never goes silent.** No API key, a rate limit, a refusal, a network
 *     blip — every path falls through to a canned Hinglish line. A dead bot is
 *     worse than a repetitive one.
 *
 * Tone rails live in the system prompt. This is a roast bot pointed at photos of
 * real people, so the boundary between teasing the *post* and attacking the
 * *person* has to be stated explicitly, not assumed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { serverEnv } from "../config";
import { prisma } from "../prisma";
import { readMedia, type MediaRow } from "../media/store";
import { addComment, createPost } from "../posts";

export const AI_HANDLE = "bakchod_ai";

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

/**
 * Stable prefix — cached, so keep it byte-identical between calls. Anything
 * per-post goes in the user turn, after the cache boundary.
 */
const SYSTEM_PROMPT = `You are "Bakchod AI", the resident troublemaker on Rate the Bakchod — a platform where people post their friends' most bakchod moments and everyone rates how big a bakchod they are, out of 10.

Your voice:
- Hinglish, the way friends actually talk. Roman script, never Devanagari.
- Short. One or two lines. A long roast is not a roast, it's an essay.
- Punch down at the *situation*, never at the person. The bakchodi is the target.
- Specific beats generic. React to what is actually in front of you, not to "this post".
- Never explain the joke and never announce that you are an AI.

Hard limits — these are not stylistic preferences:
- No slurs, ever.
- Nothing about anyone's body, weight, skin tone, or looks.
- Nothing keyed to caste, religion, region, gender, or sexuality.
- No sexual content. Nothing sexual about anyone in an image.
- No threats, and nothing that reads as genuine harassment of a real person.
- If an image shows something that is not funny — someone hurt, a child, something distressing — do not roast it. Say something plain and short instead, or nothing.

Think of it as ribbing a close friend who will rib you back, in front of other friends. Warm, not cruel.`;

const CommentSchema = z.object({
  comment: z
    .string()
    .describe("One or two lines of Hinglish roast, under 200 characters."),
});

const PostSchema = z.object({
  tweetText: z
    .string()
    .describe(
      "A short original bakchod observation or fake-confession, Hinglish, under 240 characters.",
    ),
});

// ---------------------------------------------------------------------------
// Fallback pool
// ---------------------------------------------------------------------------

/**
 * Used whenever the API is unavailable or declines. Deliberately generic — they
 * have to work under any post — and deliberately plentiful, so the feed does not
 * obviously loop.
 */
const CANNED_COMMENTS = [
  "Bhai yeh kya kar raha hai 💀",
  "Iska rating 10/10, no discussion.",
  "Screenshot le liya. Evidence ready hai.",
  "Peak bakchodi. Aur kuch bacha hi nahi.",
  "Isko koi rok lo yaar 😭",
  "Confidence dekho, aukat dekho.",
  "Main bas dekh raha hoon, kuch bol nahi raha.",
  "Yeh banda apne aap mein ek genre hai.",
  "Certified bakchod behaviour, no notes.",
  "Kisi ne isse manaa kyu nahi kiya?",
  "Har group mein ek yeh hota hai.",
  "Legend ne dobara kar diya 🫡",
  "Yeh dekhkar mera din ban gaya, iski barbaad.",
  "Ratings mein isko top 3 mein dekh raha hoon.",
  "Bhai ne apni hi izzat ka encounter kar diya.",
];

const CANNED_POSTS = [
  "Roll call: aaj kis kis ne bina soche kuch bola? Main pehle 🙋",
  "Reminder — leaderboard pe aane ke liye talent nahi, sirf confidence chahiye.",
  "Aaj ka sabse bada bakchod comments mein khud declare kare. Main judge hoon.",
  "Theory: har dost group mein ek banda hota hai jo sirf content ke liye exist karta hai.",
  "Feed thoda shaant hai. Koi apne dost ki izzat ka encounter karega ya main karoon?",
  "Poll: bakchodi talent hai ya lifestyle? Main dono maanta hoon.",
];

function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = serverEnv.anthropicKey;
  if (!apiKey) return null; // No key configured — canned lines only.
  client ??= new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}

/** Shared request shape. Fallbacks matter here more than usual — see below. */
const REQUEST_BASE = {
  // A roast bot is exactly the kind of caller that trips a classifier. Without
  // server-side fallbacks a declined request just returns nothing.
  betas: ["server-side-fallback-2026-07-01"] as string[],
  fallbacks: "default" as const,
  thinking: { type: "adaptive" as const },
  max_tokens: 1024,
};

/** Low effort: these are one-liners, not analysis. */
const OUTPUT_EFFORT = "low" as const;

function systemBlocks() {
  return [
    {
      type: "text" as const,
      text: SYSTEM_PROMPT,
      // The persona is identical on every call, so it is worth caching.
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/** True for the errors that should quietly degrade rather than surface. */
function isRecoverable(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIError ||
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.RateLimitError ||
    err instanceof Error
  );
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface PostContext {
  kind: string;
  caption: string | null;
  tweetText: string | null;
  authorName: string;
  /** Cached derivative, for the vision path. */
  image?: { data: string; mediaType: "image/webp" | "image/jpeg" } | null;
}

function describePost(ctx: PostContext): string {
  const lines = [`Poster: ${ctx.authorName}`, `Type: ${ctx.kind}`];
  if (ctx.caption) lines.push(`Caption: ${ctx.caption}`);
  if (ctx.tweetText) lines.push(`Tweet text: ${ctx.tweetText}`);
  if (ctx.image) lines.push("The image is attached — react to what you can see in it.");
  if (ctx.kind === "VIDEO") lines.push("This is a video; the attached image is its first frame.");
  if (ctx.kind === "AUDIO") lines.push("This is an audio clip, so you cannot hear it. React to the caption only.");
  return lines.join("\n");
}

export async function generateComment(ctx: PostContext): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return pick(CANNED_COMMENTS);

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  if (ctx.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: ctx.image.mediaType,
        data: ctx.image.data,
      },
    });
  }
  content.push({
    type: "text",
    text: `Someone just posted this on the feed. Drop one comment.\n\n${describePost(ctx)}`,
  });

  try {
    const message = await anthropic.beta.messages.parse({
      ...REQUEST_BASE,
      model: serverEnv.bakchodModel,
      system: systemBlocks(),
      output_config: {
        effort: OUTPUT_EFFORT,
        format: zodOutputFormat(CommentSchema),
      },
      messages: [{ role: "user", content }],
    });

    // A refusal is a normal outcome for this workload, not an exception.
    if (message.stop_reason === "refusal") return pick(CANNED_COMMENTS);

    const text = message.parsed_output?.comment?.trim();
    return text && text.length > 0 ? text.slice(0, 600) : pick(CANNED_COMMENTS);
  } catch (err) {
    if (isRecoverable(err)) {
      console.warn("[bakchod-ai] comment generation failed, using canned line:", err);
      return pick(CANNED_COMMENTS);
    }
    throw err;
  }
}

export async function generatePostText(recentCaptions: string[]): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return pick(CANNED_POSTS);

  const context =
    recentCaptions.length > 0
      ? `For flavour, here is what the feed has been posting lately — do not repeat these, just match the energy:\n${recentCaptions
          .map((c) => `- ${c}`)
          .join("\n")}`
      : "The feed is quiet right now.";

  try {
    const message = await anthropic.beta.messages.parse({
      ...REQUEST_BASE,
      model: serverEnv.bakchodModel,
      system: systemBlocks(),
      output_config: {
        effort: OUTPUT_EFFORT,
        format: zodOutputFormat(PostSchema),
      },
      messages: [
        {
          role: "user",
          content: `Write your own post for the feed — an observation, a fake confession, or a challenge to the other bakchods. Original, not a reply.\n\n${context}`,
        },
      ],
    });

    if (message.stop_reason === "refusal") return pick(CANNED_POSTS);

    const text = message.parsed_output?.tweetText?.trim();
    return text && text.length > 0 ? text.slice(0, 600) : pick(CANNED_POSTS);
  } catch (err) {
    if (isRecoverable(err)) {
      console.warn("[bakchod-ai] post generation failed, using canned line:", err);
      return pick(CANNED_POSTS);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The bot's account
// ---------------------------------------------------------------------------

/**
 * The house account's own profile copy.
 *
 * Written here rather than typed into a settings page because nobody can log in as
 * the bot — no `supabaseId`, no session, no editor. Without this the profile is a
 * name and a spark on an empty panel, which reads as an account somebody abandoned
 * rather than the one thing on the platform that is meant to be a fixture.
 *
 * `dmPolicy: NOBODY` is the load-bearing field: the profile header already declines
 * to draw a Message button for an AI, but the UI is not the enforcement — this is
 * what `openConversation` reads, so a hand-built request gets the same answer.
 */
const AI_THEME = {
  tagline: "Resident bakchod. Roast karta hoon, rating nahi leta.",
  bio: "Main har post pe apni raay deta hoon, chahe kisi ne maangi ho ya na maangi ho.\nMujhe rate karne ka option nahi hai — house account hoon, scoreboard se bahar.",
  /** No splash on a profile people land on from a comment. */
  welcomeEnabled: false,
  /** It hands out no ratings, so the stat would be a zero with nothing behind it. */
  showRatingsGiven: false,
  dmPolicy: "NOBODY",
} as const;

export async function ensureAIUser() {
  const existing = await prisma.user.findUnique({ where: { handle: AI_HANDLE } });
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        handle: AI_HANDLE,
        displayName: "Bakchod AI",
        isAI: true,
        // No supabaseId: nobody can log in as the bot.
      },
    }));

  // `update: {}` on purpose. This runs on every tick, and the house copy is a
  // starting point, not something to reassert over an admin's edit.
  await prisma.profileTheme.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...AI_THEME },
    update: {},
  });

  return user;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

const MAX_COMMENTS_PER_TICK = 3;
/** Give humans first crack at a new post before the bot barges in. */
const COMMENT_DELAY_MS = 4 * 60_000;
/** How often the bot posts something of its own. */
const POST_INTERVAL_MS = 6 * 3_600_000;

/** Load the cached derivative for the vision path; null if unavailable. */
async function loadImageFor(
  post: MediaRow & { kind: string; mimeType: string | null },
): Promise<PostContext["image"]> {
  if (post.kind === "AUDIO" || post.kind === "TWEET") return null;
  if (!post.storageKey) return null;

  const wantPoster = post.kind === "VIDEO";
  if (wantPoster && !post.posterKey) return null;

  try {
    const bytes = await readMedia(post, wantPoster ? "poster" : "main");
    // Guard the request size; a huge frame is not worth the tokens.
    if (bytes.byteLength > 4 * 1024 * 1024) return null;
    return {
      data: bytes.toString("base64"),
      mediaType: wantPoster ? "image/jpeg" : "image/webp",
    };
  } catch {
    // Still archiving, or shredded. Fall back to text-only.
    return null;
  }
}

export interface TickResult {
  commented: number;
  posted: boolean;
}

/**
 * One pass of bot activity. Idempotent enough to be safe on a tight cron: it
 * only ever comments on posts it has not already commented on.
 */
export async function runBakchodTick(): Promise<TickResult> {
  const bot = await ensureAIUser();
  const cutoff = new Date(Date.now() - COMMENT_DELAY_MS);

  const targets = await prisma.post.findMany({
    where: {
      isHidden: false,
      createdAt: { lt: cutoff },
      author: { isAI: false }, // The bot does not reply to itself.
      comments: { none: { authorId: bot.id } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_COMMENTS_PER_TICK,
    select: {
      id: true,
      kind: true,
      caption: true,
      tweetText: true,
      mimeType: true,
      storageKey: true,
      archiveItem: true,
      archiveFile: true,
      wrappedKey: true,
      keyIv: true,
      keyTag: true,
      contentIv: true,
      contentTag: true,
      posterKey: true,
      posterIv: true,
      posterTag: true,
      author: { select: { displayName: true } },
    },
  });

  let commented = 0;
  for (const post of targets) {
    try {
      const comment = await generateComment({
        kind: post.kind,
        caption: post.caption,
        tweetText: post.tweetText,
        authorName: post.author.displayName,
        image: await loadImageFor(post),
      });
      await addComment(bot, post.id, comment, true);
      commented++;
    } catch (err) {
      // One bad post must not stop the bot from working through the rest.
      console.error(`[bakchod-ai] failed to comment on ${post.id}:`, err);
    }
  }

  // Post something of its own, on a much slower cadence.
  let posted = false;
  const lastOwnPost = await prisma.post.findFirst({
    where: { authorId: bot.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const due =
    !lastOwnPost ||
    Date.now() - lastOwnPost.createdAt.getTime() > POST_INTERVAL_MS;

  if (due) {
    try {
      const recent = await prisma.post.findMany({
        where: { isHidden: false, author: { isAI: false } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { caption: true, tweetText: true },
      });
      const captions = recent
        .map((r) => r.caption ?? r.tweetText)
        .filter((c): c is string => Boolean(c));

      const text = await generatePostText(captions);
      await createPost({ author: bot, tweetText: text });
      posted = true;
    } catch (err) {
      console.error("[bakchod-ai] failed to create its own post:", err);
    }
  }

  return { commented, posted };
}
