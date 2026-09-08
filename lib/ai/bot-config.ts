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
  /**
   * And of the ones that are not cards, three in ten are a poll rather than a line.
   * Applied after the card roll, so this is a share of the rest — not of everything.
   */
  pollPercent: 30,
} as const;

/**
 * Ranges the form and the API both enforce.
 *
 * The floors are all zero or near it because switching one behaviour off is a
 * legitimate setting: no comments, no cards, no polls, no delay. The ceilings exist so
 * a fat-fingered paste cannot turn the bot into a load generator or park its next
 * post beyond the heat death of the feed.
 */
export const BOT_BOUNDS = {
  commentDelayMinutes: { min: 0, max: 1440 },
  maxCommentsPerTick: { min: 0, max: 20 },
  postIntervalMinutes: { min: 5, max: 20160 },
  cardPercent: { min: 0, max: 100 },
  pollPercent: { min: 0, max: 100 },
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
  pollPercent: bounded("pollPercent"),
});

export type BotTuning = z.infer<typeof BotTuningSchema>;

/** A field that was left alone, cleared back to the environment, or replaced. */
const credential = (max: number) => z.string().trim().max(max).optional();

/**
 * The three credential fields, named so both the single `BotSetting` and a
 * `BotEndpoint` row are validated by the same rules. A value typed into either half of
 * the panel deserves the same catch as one pasted into Railway, which is why these are
 * the refinements `scripts/check-env.mjs` applies to the environment.
 */
const API_KEY = credential(400).refine(
  (value) => value === undefined || value === "" || !/\s/.test(value),
  "That key has whitespace in it — check the paste.",
);

/**
 * The origin of a gateway, with no path on it.
 *
 * The path is chosen per call, not stored: `/v1/messages` for an Anthropic-shaped
 * endpoint and `/v1/chat/completions` for an OpenAI-shaped one, whichever this gateway
 * turns out to serve. Which is also why a pasted `/v1` has to be caught here — it would
 * be doubled on either of them.
 */
const BASE_URL = credential(300)
  .refine(
    (value) => value === undefined || value === "" || /^https?:\/\//i.test(value),
    "Base URL has to start with http:// or https://.",
  )
  .refine(
    (value) => value === undefined || value === "" || !/\/v1\/?$/.test(value),
    "Drop the /v1 — the path is added for you, so this would ask for /v1/v1/… instead.",
  );

const MODEL = credential(120).refine(
  (value) => value === undefined || value === "" || /^[A-Za-z0-9._:-]+$/.test(value),
  "A model id is letters, digits, dots, colons, dashes and underscores.",
);

/**
 * Credential edits, three-way per field: absent leaves it as it is, an empty string
 * clears it back to the environment variable, anything else replaces it.
 */
export const BotCredentialsSchema = z.object({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
  model: MODEL,
});

export type BotCredentials = z.infer<typeof BotCredentialsSchema>;

/**
 * A fallback endpoint's name, which is the only thing about it the panel ever renders.
 *
 * Short on purpose: it sits in a row of pills, and its whole job is to be recognisable
 * to whoever typed it — "tabitoken", "spare key" — not to describe the gateway.
 */
const LABEL = z.string().trim().min(1, "Give it a name.").max(40);

/**
 * A new endpoint.
 *
 * The key is required, unlike everywhere else: a row with no key is skipped by the
 * failover chain, so creating one would be adding a name to a list and nothing else.
 * Base URL and model are optional — two keys on the same gateway is a real fallback,
 * for when the first one hits its quota.
 */
export const EndpointCreateSchema = z.object({
  label: LABEL,
  apiKey: z.string().trim().min(1, "A fallback needs its own key.").max(400).refine(
    (value) => !/\s/.test(value),
    "That key has whitespace in it — check the paste.",
  ),
  baseUrl: BASE_URL,
  model: MODEL,
});

export type EndpointCreate = z.infer<typeof EndpointCreateSchema>;

/**
 * An edit to an existing endpoint: what it is called, and whether it is in the chain.
 *
 * Deliberately not its key, base URL or model. Nothing here can show which value is
 * being replaced — that is the entire point of this panel — so a box for one would
 * either wipe a working credential by being left empty or lie about what is already in
 * it. Delete the row and add it again: one press more, and no ambiguity.
 */
export const EndpointPatchSchema = z.object({
  label: LABEL.optional(),
  enabled: z.boolean().optional(),
});

export type EndpointPatch = z.infer<typeof EndpointPatchSchema>;

/** Reordering is a separate body, because it is a swap and not a field. */
export const EndpointMoveSchema = z.object({ move: z.enum(["up", "down"]) });

/**
 * One endpoint, as the admin panel is allowed to see it.
 *
 * Booleans where the values are, on the same rule as {@link CredentialSource}: whether
 * a key is stored, not the key; whether a base URL is set, not which host. The health
 * fields are shaped to keep that promise too — `lastStatus` is a number and `lastError`
 * is an error's *class name*, because an SDK error's message can quote the request URL.
 */
export interface EndpointStatus {
  id: string;
  label: string;
  enabled: boolean;
  hasKey: boolean;
  hasBaseUrl: boolean;
  hasModel: boolean;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  /** Consecutive failures, reset by the next success. */
  failures: number;
}

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
   * When the background heartbeat last claimed a tick. Null means it never has —
   * which, on a host with nothing scheduling `/api/cron/bakchod`, is the difference
   * between a bot that posts on its own and one that waits for the button.
   */
  lastTickAt: string | null;
  /**
   * Whether this container can draw text at all. False means cards silently become
   * text posts, which is otherwise invisible from the outside.
   */
  canRenderCards: boolean;
}
