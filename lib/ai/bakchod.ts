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
 *
 * Rule 2 is why there are two request shapes rather than one — see `askForLine`.
 * Falling back to a canned line is the right answer to a rate limit and the wrong
 * answer to a gateway that does not speak beta, because the second one never clears
 * up on its own.
 *
 * Nothing in here decides how often any of it happens. Cadence and credentials both
 * come from `./settings`, so an admin can retune the bot or repoint it at a different
 * gateway without a deploy.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "../prisma";
// The bot's account — handle, profile copy, picture — lives beside the platform's
// own in `lib/house-accounts.ts`: an account nobody can log in as still needs a
// face, and whatever writes one should write both the same way.
import { ensureAIUser } from "../house-accounts";
import { readMedia, type MediaRow } from "../media/store";
import { addComment, createPost } from "../posts";
import { CARD_LAYOUTS, renderBakchodCard, type CardLayout } from "./card";
import { loadBotSettings, type BotSettings } from "./settings";

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

/**
 * The line that gets set on a card.
 *
 * Tighter than a text post because this one is printed at 76px inside a 1080px
 * square — `sizeFor` will shrink it to fit, but a line that needs shrinking is a
 * line that wanted to be a paragraph.
 */
const CardSchema = z.object({
  line: z
    .string()
    .describe(
      "One punchy Hinglish line, under 110 characters, to be printed large on a plain card. No surrounding quotes, no hashtags, no emoji.",
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
/** The credentials `client` was built from, so a change can be noticed. */
let clientFingerprint = "";

/**
 * Whether this endpoint has already said it does not understand the rich request.
 *
 * Latched until the credentials change, so the wasted first call is paid once rather
 * than before every line the bot writes.
 */
let plainShape = false;

/**
 * The SDK client for these settings, or null when there is no key anywhere.
 *
 * Keyed on the credentials rather than memoised for the life of the process, because
 * the admin panel can change them underneath a running container: a key saved from a
 * phone has to take effect on the next tick, not on the next deploy.
 */
function getClient(settings: BotSettings): Anthropic | null {
  const { apiKey, baseUrl } = settings;
  if (!apiKey) return null; // No key configured — canned lines only.

  const fingerprint = `${apiKey}\n${baseUrl ?? ""}`;
  if (!client || fingerprint !== clientFingerprint) {
    // An unset base URL is safe to pass: the SDK takes it as a destructuring default,
    // so `undefined` still falls through to api.anthropic.com rather than clearing it.
    client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 2 });
    clientFingerprint = fingerprint;
    // The latch is a fact about one endpoint, not about the bot. A new base URL has
    // earned a fresh chance at the shape the old one refused.
    plainShape = false;
  }
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

/**
 * True for the answer a bare `/v1/messages` proxy gives to the parameters above.
 *
 * `ANTHROPIC_BASE_URL` usually points at a gateway that forwards one endpoint and
 * knows nothing about betas, adaptive thinking, structured outputs or prompt
 * caching, so it rejects the whole request over a field it has never heard of. That
 * is not a reason to fall back to canned lines — the same prompt sent the plain way
 * would have worked — so it gets a retry rather than a shrug.
 */
function unsupportedShape(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  return err.status === 400 || err.status === 404 || err.status === 422;
}

/** Trim, cap, and treat an empty reply as no reply. */
function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, 600) : null;
}

/**
 * Ask for one line, in whichever request shape this endpoint accepts.
 *
 * First choice is the rich one: server-side fallbacks so a tripped classifier still
 * answers, adaptive thinking, a cached persona, and a schema so the reply arrives
 * needing no cleanup. When the endpoint refuses that shape the same prompt goes out
 * as an ordinary `messages.create` and the text is read back by hand. Worse — but
 * the alternative is a bot that has been quietly reciting canned Hinglish since the
 * day a gateway was configured, with a healthy-looking log to match.
 *
 * `null` means no usable line: a refusal, or an empty reply. Callers turn that into
 * a canned line. A thrown error is theirs to catch.
 */
async function askForLine<S extends z.ZodType>(
  anthropic: Anthropic,
  model: string,
  schema: S,
  field: string,
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
): Promise<string | null> {
  if (!plainShape) {
    try {
      const message = await anthropic.beta.messages.parse({
        ...REQUEST_BASE,
        model,
        system: systemBlocks(),
        output_config: {
          effort: OUTPUT_EFFORT,
          format: zodOutputFormat(schema),
        },
        messages: [{ role: "user", content }],
      });

      // A refusal is a normal outcome for this workload, not an exception.
      if (message.stop_reason === "refusal") return null;
      return oneLine((message.parsed_output as Record<string, unknown> | null)?.[field]);
    } catch (err) {
      if (!unsupportedShape(err)) throw err;
      plainShape = true;
      console.warn(
        "[bakchod-ai] endpoint refused the rich request shape; sending plain messages from here on:",
        err,
      );
    }
  }

  const message = await anthropic.messages.create({
    model,
    max_tokens: REQUEST_BASE.max_tokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          // Only text and image blocks are ever built for this, and those two are
          // shaped identically in both unions — the beta one is just the wider pair.
          ...(content as Anthropic.ContentBlockParam[]),
          // The schema carried this instruction on the rich path.
          { type: "text", text: "Reply with the line itself. No JSON, no quotes, no preamble." },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") return null;
  return oneLine(
    message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" "),
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

export async function generateComment(
  settings: BotSettings,
  ctx: PostContext,
): Promise<string> {
  const anthropic = getClient(settings);
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
    return (
      (await askForLine(anthropic, settings.model, CommentSchema, "comment", content)) ??
      pick(CANNED_COMMENTS)
    );
  } catch (err) {
    if (isRecoverable(err)) {
      console.warn("[bakchod-ai] comment generation failed, using canned line:", err);
      return pick(CANNED_COMMENTS);
    }
    throw err;
  }
}

export async function generatePostText(
  settings: BotSettings,
  recentCaptions: string[],
): Promise<string> {
  const anthropic = getClient(settings);
  if (!anthropic) return pick(CANNED_POSTS);

  const context =
    recentCaptions.length > 0
      ? `For flavour, here is what the feed has been posting lately — do not repeat these, just match the energy:\n${recentCaptions
          .map((c) => `- ${c}`)
          .join("\n")}`
      : "The feed is quiet right now.";

  try {
    const line = await askForLine(anthropic, settings.model, PostSchema, "tweetText", [
      {
        type: "text",
        text: `Write your own post for the feed — an observation, a fake confession, or a challenge to the other bakchods. Original, not a reply.\n\n${context}`,
      },
    ]);
    return line ?? pick(CANNED_POSTS);
  } catch (err) {
    if (isRecoverable(err)) {
      console.warn("[bakchod-ai] post generation failed, using canned line:", err);
      return pick(CANNED_POSTS);
    }
    throw err;
  }
}

/** What each layout is asking for, in one clause. The look is in `./card`. */
const CARD_BRIEF: Record<CardLayout, string> = {
  certificate: "an award citation for a bakchod who has thoroughly earned it",
  notice: "a mock public notice, the way a housing society pins one to the lift",
  confession: "a confession the whole feed will recognise itself in",
};

/**
 * The line for a picture post, or null to skip the picture.
 *
 * Deliberately no canned fallback. Rule 2 is about the bot never going silent, and
 * the caller keeps that promise by posting text instead — whereas six canned lines
 * cycling through a designed plaque would be six recognisable pictures forever.
 */
async function generateCardLine(
  settings: BotSettings,
  layout: CardLayout,
): Promise<string | null> {
  const anthropic = getClient(settings);
  if (!anthropic) return null;

  try {
    return await askForLine(anthropic, settings.model, CardSchema, "line", [
      {
        type: "text",
        text: `Write ${CARD_BRIEF[layout]}. It will be printed large on a plain card, so it has to land on its own with no post around it — no reply, no context, no "as I was saying".`,
      },
    ]);
  } catch (err) {
    if (isRecoverable(err)) {
      console.warn("[bakchod-ai] card line failed, posting text instead:", err);
      return null;
    }
    throw err;
  }
}

/**
 * Try for a picture post: the model writes the line, the server sets it.
 *
 * Null whenever anything ordinary goes wrong — no key, a refusal, or a container
 * with no font installed ({@link renderBakchodCard} answers null for that) — and the
 * caller falls back to a text post, so a missing font costs pictures rather than the
 * whole slot.
 */
async function renderOwnCard(
  settings: BotSettings,
): Promise<{ png: Buffer; line: string } | null> {
  const layout = pick(CARD_LAYOUTS);
  try {
    const line = await generateCardLine(settings, layout);
    if (!line) return null;
    const png = await renderBakchodCard(layout, line);
    return png ? { png, line } : null;
  } catch (err) {
    console.warn("[bakchod-ai] card render failed, posting text instead:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

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
  /** True when the bot is switched off, so a caller can say so rather than "0". */
  skipped: boolean;
}

/**
 * One pass of bot activity. Idempotent enough to be safe on a tight cron: it
 * only ever comments on posts it has not already commented on.
 *
 * Every number in here comes from the settings row, read once per tick. That is why
 * it is read per tick rather than cached: a cadence changed in the admin panel applies
 * to the next tick, with nothing to restart.
 */
export async function runBakchodTick(): Promise<TickResult> {
  const settings = await loadBotSettings();
  if (!settings.enabled) return { commented: 0, posted: false, skipped: true };

  const bot = await ensureAIUser();
  const cutoff = new Date(Date.now() - settings.commentDelayMinutes * 60_000);

  // Zero is the documented way to stop commenting without stopping posts, and
  // `take: 0` would be a round trip that can only come back empty.
  const targets =
    settings.maxCommentsPerTick === 0
      ? []
      : await prisma.post.findMany({
          where: {
            isHidden: false,
            createdAt: { lt: cutoff },
            author: { isAI: false }, // The bot does not reply to itself.
            comments: { none: { authorId: bot.id } },
          },
          orderBy: { createdAt: "desc" },
          take: settings.maxCommentsPerTick,
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
      const comment = await generateComment(settings, {
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
    Date.now() - lastOwnPost.createdAt.getTime() >
      settings.postIntervalMinutes * 60_000;

  if (due) {
    try {
      // Decided before the feed context is fetched, because a card does not use it:
      // a plaque has to land on its own, so priming it with what the feed said last
      // is both pointless and a query.
      const wantCard = Math.random() * 100 < settings.cardPercent;
      const card = wantCard ? await renderOwnCard(settings) : null;

      if (card) {
        // The caption repeats the line deliberately. The card is a picture of a
        // sentence, and the sentence has to exist as text as well — it is the image's
        // alt text, the notification preview, and the whole post for anyone whose
        // image never loads.
        await createPost({ author: bot, file: card.png, caption: card.line });
      } else {
        const recent = await prisma.post.findMany({
          where: { isHidden: false, author: { isAI: false } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { caption: true, tweetText: true },
        });
        const captions = recent
          .map((r) => r.caption ?? r.tweetText)
          .filter((c): c is string => Boolean(c));

        await createPost({
          author: bot,
          tweetText: await generatePostText(settings, captions),
        });
      }
      posted = true;
    } catch (err) {
      console.error("[bakchod-ai] failed to create its own post:", err);
    }
  }

  return { commented, posted, skipped: false };
}
