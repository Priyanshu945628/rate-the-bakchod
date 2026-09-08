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
 * up on its own. It is also why there is a *list* of gateways rather than one: an
 * expired key used to be the whole bot, and now it is one entry that gets skipped.
 *
 * Nothing in here decides how often any of it happens. Cadence and credentials both
 * come from `./settings`, so an admin can retune the bot, add another gateway or reorder
 * them without a deploy.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import { z } from "zod";
import { limits } from "../config";
import { prisma } from "../prisma";
// The bot's account — handle, profile copy, picture — lives beside the platform's
// own in `lib/house-accounts.ts`: an account nobody can log in as still needs a
// face, and whatever writes one should write both the same way.
import { ensureAIUser } from "../house-accounts";
import { readMedia, type MediaRow } from "../media/store";
import { addComment, createPost } from "../posts";
import { CARD_LAYOUTS, renderBakchodCard, type CardLayout } from "./card";
import { recordEndpointFailure, recordEndpointOk } from "./endpoints";
import { loadBotSettings, type BotCandidate, type BotSettings } from "./settings";

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

/**
 * A poll the bot wants to run.
 *
 * The counts are in the schema rather than only in the prose because this is the one
 * output a post's *shape* depends on: `createPost` refuses a poll with fewer than
 * `pollMinOptions` answers, so asking loosely and hoping would turn a slot into a
 * logged error. Everything that comes back is clamped again in `cleanPoll` — the
 * plain-text path below has no schema to enforce anything.
 */
const PollSchema = z.object({
  question: z
    .string()
    .describe(
      "The question, Hinglish, under 140 characters. It has to be answerable by picking one of the options — not open-ended, and not a yes/no you already know the answer to.",
    ),
  options: z
    .array(
      z
        .string()
        .describe("One answer, Hinglish, under 60 characters. Funny, but a real answer."),
    )
    .min(limits.pollMinOptions)
    .max(limits.pollMaxOptions)
    .describe(
      `Between ${limits.pollMinOptions} and ${limits.pollMaxOptions} answers, all different, none of them obviously the correct one.`,
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
  // No canned poll in here on purpose: a poll is buttons people press, and six of
  // them on a loop would be the same question asked forever. When the model cannot
  // write one, the tick posts a line instead — see `runBakchodTick`.
  "Bakchodi ek talent hai, aur main iska self-appointed brand ambassador hoon.",
];

function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** One live gateway. */
interface Live {
  client: Anthropic;
  /**
   * Whether this endpoint has already said it does not understand the rich request.
   *
   * Latched per endpoint rather than globally, so one gateway that only speaks plain
   * `/v1/messages` does not cost every other gateway its structured output — and so the
   * wasted first call is paid once each rather than before every line the bot writes.
   */
  plainShape: boolean;
}

/**
 * Clients by credential digest.
 *
 * Kept between ticks because the settings rarely change and building a client is not
 * free, but keyed on a **digest** of the credentials rather than the credentials
 * themselves: nothing in this process should be holding a map whose keys are API keys.
 * Capped, so an admin editing keys all afternoon cannot grow it without bound.
 */
const live = new Map<string, Live>();
const LIVE_MAX = 8;

function clientFor(candidate: BotCandidate): Live {
  const digest = createHash("sha256")
    .update(`${candidate.id ?? "default"}\n${candidate.apiKey}\n${candidate.baseUrl ?? ""}`)
    .digest("hex");

  const existing = live.get(digest);
  if (existing) return existing;

  const entry: Live = {
    // An unset base URL is safe to pass: the SDK takes it as a destructuring default,
    // so `undefined` still falls through to api.anthropic.com rather than clearing it.
    client: new Anthropic({
      apiKey: candidate.apiKey,
      baseURL: candidate.baseUrl,
      maxRetries: 2,
    }),
    plainShape: false,
  };

  // A rotated key leaves its client behind. Evict the oldest rather than clearing the
  // map — insertion order means the first key is the one added longest ago.
  if (live.size >= LIVE_MAX) {
    const oldest = live.keys().next();
    if (!oldest.done) live.delete(oldest.value);
  }
  live.set(digest, entry);
  return entry;
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
  endpoint: Live,
  model: string,
  schema: S,
  field: string,
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
): Promise<string | null> {
  if (!endpoint.plainShape) {
    try {
      const message = await endpoint.client.beta.messages.parse({
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
      endpoint.plainShape = true;
      console.warn(
        "[bakchod-ai] endpoint refused the rich request shape; sending plain messages from here on:",
        err,
      );
    }
  }

  const message = await endpoint.client.messages.create({
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

/** A question and its answers, already trimmed to what a post will accept. */
export interface GeneratedPoll {
  question: string;
  options: string[];
}

/**
 * What the plain path asks for instead of a schema.
 *
 * Lines rather than JSON: a gateway that does not speak structured outputs is usually
 * fronting an older model too, and a hand-written JSON object comes back with a stray
 * trailing comma often enough to matter. Lines cannot be malformed.
 */
const POLL_PLAIN_INSTRUCTION = `Reply as plain lines and nothing else: the question on the first line, then one option per line, up to ${limits.pollMaxOptions} of them. No JSON, no numbering, no blank lines, no preamble.`;

/** `- answer`, `2) answer`, `• answer` — whatever the plain path decorated it with. */
function stripMarker(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, "")
    .trim();
}

/**
 * Turn whatever came back into a poll, or into nothing.
 *
 * Clamps rather than complains, in the same spirit as `cleanPollOptions`: a fifth
 * option is dropped, a long one is cut, a repeated one is thrown away — because the
 * alternative is `createPost` refusing the post and the bot losing the slot over a
 * detail nobody would have noticed. Null only for the cases that are not a poll at
 * all: no question, or fewer than two things to press.
 */
function cleanPoll(question: unknown, options: readonly unknown[]): GeneratedPoll | null {
  const asked = oneLine(question);
  if (!asked) return null;

  const seen = new Set<string>();
  const answers: string[] = [];
  for (const entry of options) {
    if (typeof entry !== "string") continue;
    const label = entry.trim().slice(0, limits.pollOptionMaxLength).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push(label);
    if (answers.length === limits.pollMaxOptions) break;
  }

  if (answers.length < limits.pollMinOptions) return null;
  return { question: asked.slice(0, limits.captionMaxLength).trim(), options: answers };
}

/**
 * Ask for a poll, in whichever request shape this endpoint accepts.
 *
 * The same two-shape story as {@link askForLine}, and it shares the latch: an endpoint
 * that has already refused the rich shape goes straight to plain, whichever call found
 * that out. The difference is only in the reading — a schema on one side, the first
 * line and the rest on the other.
 */
async function askForPoll(
  endpoint: Live,
  model: string,
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
): Promise<GeneratedPoll | null> {
  if (!endpoint.plainShape) {
    try {
      const message = await endpoint.client.beta.messages.parse({
        ...REQUEST_BASE,
        model,
        system: systemBlocks(),
        output_config: {
          effort: OUTPUT_EFFORT,
          format: zodOutputFormat(PollSchema),
        },
        messages: [{ role: "user", content }],
      });

      if (message.stop_reason === "refusal") return null;
      const parsed = message.parsed_output as {
        question?: unknown;
        options?: unknown;
      } | null;
      return cleanPoll(
        parsed?.question,
        Array.isArray(parsed?.options) ? parsed.options : [],
      );
    } catch (err) {
      if (!unsupportedShape(err)) throw err;
      endpoint.plainShape = true;
      console.warn(
        "[bakchod-ai] endpoint refused the rich request shape; sending plain messages from here on:",
        err,
      );
    }
  }

  const message = await endpoint.client.messages.create({
    model,
    max_tokens: REQUEST_BASE.max_tokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...(content as Anthropic.ContentBlockParam[]),
          { type: "text", text: POLL_PLAIN_INSTRUCTION },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") return null;

  const lines = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .split("\n")
    .map(stripMarker)
    .filter((line) => line.length > 0);

  return cleanPoll(lines[0], lines.slice(1));
}

/**
 * Ask each configured gateway in turn, until one of them answers.
 *
 * The distinction that makes this safe is between a **null** and a **throw**. Null is
 * the model having answered — a refusal, or an empty reply — so the chain stops there:
 * sending the same roast prompt down the list until one gateway agrees to write it would
 * be shopping for a model with worse judgement. A throw is the endpoint itself failing,
 * and the next endpoint is exactly what that is for.
 *
 * Null out of here therefore means one of three things, all of which the callers answer
 * the same way: nothing is configured, the model declined, or every endpoint is down.
 *
 * Generic in what is being asked for, because a poll comes back as an object and a
 * roast as a string, and which of those it is has nothing to do with failover.
 */
async function acrossEndpoints<T>(
  settings: BotSettings,
  ask: (endpoint: Live, model: string) => Promise<T | null>,
): Promise<T | null> {
  for (const candidate of settings.candidates) {
    try {
      const answer = await ask(clientFor(candidate), candidate.model);
      // Stamped even for a refusal: the gateway answered, which is all this records.
      await recordEndpointOk(candidate.id);
      return answer;
    } catch (err) {
      // Not an endpoint problem, and not something a different gateway will answer
      // differently. `isRecoverable` is deliberately broad, so this is close to "somebody
      // threw a string" — but a bug in here must not read as a dead endpoint.
      if (!isRecoverable(err)) throw err;
      await recordEndpointFailure(candidate.id, err);
      // The label is what the panel shows, so the log and the pill name the same thing.
      console.warn(`[bakchod-ai] endpoint "${candidate.label}" failed:`, err);
    }
  }

  return null;
}

/** One line, from whichever gateway answers first. */
function askAcrossEndpoints<S extends z.ZodType>(
  settings: BotSettings,
  schema: S,
  field: string,
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
): Promise<string | null> {
  return acrossEndpoints(settings, (endpoint, model) =>
    askForLine(endpoint, model, schema, field, content),
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
  /** A poll's answers, so a comment on one can react to the choices on offer. */
  options?: string[] | null;
  /** Cached derivative, for the vision path. */
  image?: { data: string; mediaType: "image/webp" | "image/jpeg" } | null;
}

function describePost(ctx: PostContext): string {
  const lines = [`Poster: ${ctx.authorName}`, `Type: ${ctx.kind}`];
  if (ctx.caption) lines.push(`Caption: ${ctx.caption}`);
  if (ctx.tweetText) lines.push(`Tweet text: ${ctx.tweetText}`);
  if (ctx.options?.length) {
    lines.push(`It is a poll. The caption is the question, and the options are: ${ctx.options.join(" / ")}`);
  }
  if (ctx.image) lines.push("The image is attached — react to what you can see in it.");
  if (ctx.kind === "VIDEO") lines.push("This is a video; the attached image is its first frame.");
  if (ctx.kind === "AUDIO") lines.push("This is an audio clip, so you cannot hear it. React to the caption only.");
  return lines.join("\n");
}

export async function generateComment(
  settings: BotSettings,
  ctx: PostContext,
): Promise<string> {
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

  return (
    (await askAcrossEndpoints(settings, CommentSchema, "comment", content)) ??
    pick(CANNED_COMMENTS)
  );
}

/** What the feed has been saying, for whichever prompt wants the room's temperature. */
function feedFlavour(recentCaptions: string[]): string {
  return recentCaptions.length > 0
    ? `For flavour, here is what the feed has been posting lately — do not repeat these, just match the energy:\n${recentCaptions
        .map((c) => `- ${c}`)
        .join("\n")}`
    : "The feed is quiet right now.";
}

export async function generatePostText(
  settings: BotSettings,
  recentCaptions: string[],
): Promise<string> {
  const line = await askAcrossEndpoints(settings, PostSchema, "tweetText", [
    {
      type: "text",
      text: `Write your own post for the feed — an observation, a fake confession, or a challenge to the other bakchods. Original, not a reply.\n\n${feedFlavour(recentCaptions)}`,
    },
  ]);
  return line ?? pick(CANNED_POSTS);
}

/**
 * A poll for the feed, or null to skip it.
 *
 * Deliberately no canned fallback, for the reason {@link generateCardLine} has none
 * and more so: a canned poll is a fixed set of buttons, and once the feed has answered
 * it once, asking it again is asking a question whose answer is already on the site.
 * The caller posts a line instead, so rule 2 is kept without the bot repeating itself
 * in the one format that shows its repetition as numbers.
 */
export async function generatePoll(
  settings: BotSettings,
  recentCaptions: string[],
): Promise<GeneratedPoll | null> {
  return acrossEndpoints(settings, (endpoint, model) =>
    askForPoll(endpoint, model, [
      {
        type: "text",
        text: `Run a poll on the feed: one question, and ${limits.pollMinOptions} to ${limits.pollMaxOptions} answers people pick between. Something this group would actually argue about — not a quiz, and not a question with one obviously right answer.\n\n${feedFlavour(recentCaptions)}`,
      },
    ]),
  );
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
  return askAcrossEndpoints(settings, CardSchema, "line", [
    {
      type: "text",
      text: `Write ${CARD_BRIEF[layout]}. It will be printed large on a plain card, so it has to land on its own with no post around it — no reply, no context, no "as I was saying".`,
    },
  ]);
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

/**
 * Exported for `test/ai-poll.test.ts`, which asserts what a model's answer is allowed
 * to turn into. Everything reachable from here is pure — no client, no settings row —
 * which is the whole reason the parsing lives in its own functions.
 */
export const __pollInternals = { cleanPoll, stripMarker };

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
            pollOptions: { select: { label: true }, orderBy: { position: "asc" } },
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
        options: post.pollOptions.map((o) => o.label),
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

        // Rolled only among the posts that are not cards, which is what makes these
        // two percentages an order rather than two shares somebody has to keep adding
        // up to 100. Null here — no key, a refusal, or an answer that was not a poll —
        // falls through to a line, so a poll is never the reason the slot goes empty.
        const poll =
          Math.random() * 100 < settings.pollPercent
            ? await generatePoll(settings, captions)
            : null;

        if (poll) {
          // Through the same `createPost` a person's poll goes through, which is where
          // the rule lives: voting writes no rating, no aggregate and no total, so the
          // house account can ask the feed a question with nothing scored either way.
          await createPost({
            author: bot,
            caption: poll.question,
            pollOptions: poll.options,
          });
        } else {
          await createPost({
            author: bot,
            tweetText: await generatePostText(settings, captions),
          });
        }
      }
      posted = true;
    } catch (err) {
      console.error("[bakchod-ai] failed to create its own post:", err);
    }
  }

  return { commented, posted, skipped: false };
}
