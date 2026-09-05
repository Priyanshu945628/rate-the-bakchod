/**
 * The AI bakchod's knobs, and what counts as a valid setting.
 *
 * Deliberately NOT `server-only`, on the same footing as `lib/profile-schema.ts`:
 * the admin form imports these bounds so the number inputs and the API agree on
 * what is allowed. The server is still the only authority — the client copy exists
 * to catch a typo before a round trip, not to be trusted.
 *
 * Every default here matches a `@default` on `model BotSetting`. They are what the
 * bot uses when nobody has ever saved a row, so if one moves the other moves too.
 */

import { z } from "zod";

export const BOT_DEFAULTS = {
  enabled: true,
  /** Give humans first crack at a new post before the bot barges in. */
  commentDelayMinutes: 4,
  maxCommentsPerTick: 3,
  /** Six hours. */
  postIntervalMinutes: 360,
  /** Two in five of its own posts are a rendered card rather than a line of text. */
  cardPercent: 40,
} as const;

/**
 * Ranges the form and the API both enforce.
 *
 * The floors are all zero or near it because switching one behaviour off is a
 * legitimate setting: no comments, no cards, no delay. The ceilings exist so a
 * fat-fingered paste cannot turn the bot into a load generator or park its next
 * post beyond the heat death of the feed.
 */
export const BOT_BOUNDS = {
  commentDelayMinutes: { min: 0, max: 1440 },
  maxCommentsPerTick: { min: 0, max: 20 },
  postIntervalMinutes: { min: 5, max: 20160 },
  cardPercent: { min: 0, max: 100 },
} as const;

type BoundedKey = keyof typeof BOT_BOUNDS;

const bounded = (key: BoundedKey) =>
  z.number().int().min(BOT_BOUNDS[key].min).max(BOT_BOUNDS[key].max);

export const BotTuningSchema = z.object({
  enabled: z.boolean(),
  commentDelayMinutes: bounded("commentDelayMinutes"),
  maxCommentsPerTick: bounded("maxCommentsPerTick"),
  postIntervalMinutes: bounded("postIntervalMinutes"),
  cardPercent: bounded("cardPercent"),
});

export type BotTuning = z.infer<typeof BotTuningSchema>;

/** A field that was left alone, cleared back to the environment, or replaced. */
const credential = (max: number) => z.string().trim().max(max).optional();

/**
 * Credential edits, three-way per field: absent leaves it as it is, an empty string
 * clears it back to the environment variable, anything else replaces it.
 *
 * The refinements are the same ones `scripts/check-env.mjs` applies to the
 * environment, because a value typed into the panel deserves the same catch as one
 * pasted into Railway.
 */
export const BotCredentialsSchema = z.object({
  apiKey: credential(400).refine(
    (value) => value === undefined || value === "" || !/\s/.test(value),
    "That key has whitespace in it — check the paste.",
  ),
  baseUrl: credential(300)
    .refine(
      (value) => value === undefined || value === "" || /^https?:\/\//i.test(value),
      "Base URL has to start with http:// or https://.",
    )
    .refine(
      (value) => value === undefined || value === "" || !/\/v1\/?$/.test(value),
      "Drop the /v1 — the SDK adds it, so this would ask for /v1/v1/messages.",
    ),
  model: credential(120).refine(
    (value) => value === undefined || value === "" || /^[A-Za-z0-9._:-]+$/.test(value),
    "A model id is letters, digits, dots, colons, dashes and underscores.",
  ),
});

export type BotCredentials = z.infer<typeof BotCredentialsSchema>;

/**
 * Where a credential is coming from. This is the most the admin panel is ever told
 * about one — not the value, and not a masked version of it, because a mask still
 * confirms a length.
 */
export type CredentialSource = "database" | "environment" | "unset";

export interface BotStatus extends BotTuning {
  apiKey: CredentialSource;
  baseUrl: CredentialSource;
  model: CredentialSource;
  /** Null until something has been saved from the panel. */
  updatedAt: string | null;
  /**
   * Whether this container can draw text at all. False means cards silently become
   * text posts, which is otherwise invisible from the outside.
   */
  canRenderCards: boolean;
}
