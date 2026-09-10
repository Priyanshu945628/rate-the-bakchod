import "server-only";

/**
 * Reading and writing the bot's settings row.
 *
 * Two rules shape this file:
 *
 *  1. **A credential goes in and never comes back out.** `loadBotSettings` returns
 *     the key because the SDK needs it; `readBotStatus` — the only thing the admin
 *     panel calls — returns where each credential came from and nothing else.
 *  2. **A missing row, a missing table or an unreadable key must not stop the bot.**
 *     Every failure here falls back to the environment or to `BOT_DEFAULTS`, because
 *     the alternative is a settings page taking the feed down with it.
 *
 * The key is sealed with the same envelope as media — see `./sealed`, which this file
 * shares with the fallback endpoints: a per-row data key encrypts the value,
 * `MEDIA_MASTER_KEY` wraps the data key. That means the master key is the only thing
 * standing between a database dump and the key — which is already true of every uploaded
 * photo, so it is one secret to protect rather than two.
 */

import { serverEnv } from "../config";
import { prisma } from "../prisma";
import { seal, SHREDDED, unseal, type SealedWrite } from "./sealed";
import { loadEndpointCredentials } from "./endpoints";
import {
  BOT_DEFAULTS,
  type BotCredentials,
  type BotStatus,
  type BotTuning,
  type CredentialSource,
} from "./bot-config";

/** One row, always. */
const ROW_ID = 1;

/**
 * Additional authenticated data for the wrapped key.
 *
 * Constant rather than a random storage key, because unlike media there is exactly
 * one row: the point of the AAD is that a wrapped key lifted from one row cannot be
 * replayed against another, and here there is no other row to replay it into. The
 * fallback endpoints in `./endpoints` do have other rows, which is why theirs is not.
 */
const AAD = "bot-setting";

/**
 * One gateway to try, with everything filled in.
 *
 * `id` is null for the credential on the settings row (or, failing that, the
 * environment): it is the one candidate with no `BotEndpoint` to stamp health on, and
 * it always goes last, so adding fallbacks never disturbs a setup that already works.
 */
export interface BotCandidate {
  id: string | null;
  /** For logs and the panel's health pill. Never a value.  */
  label: string;
  apiKey: string;
  /** Undefined means api.anthropic.com; the SDK takes it as a default. */
  baseUrl: string | undefined;
  model: string;
}

export interface BotSettings extends BotTuning {
  /**
   * Every gateway to try, in order. Empty means no key anywhere — the bot runs on
   * canned lines, which is a working feed and not an error.
   */
  candidates: BotCandidate[];
}

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>;

function findRow() {
  return prisma.botSetting.findUnique({ where: { id: ROW_ID } });
}

/**
 * The row, or null when there isn't one — including when there is no table yet.
 *
 * Swallowing the error is deliberate. These settings are read on every tick and on
 * the admin page, and the SQL for this table is run by hand; until it has been, the
 * honest behaviour is a bot on its defaults rather than a feed that 500s.
 */
async function loadRow(): Promise<Row | null> {
  try {
    return await findRow();
  } catch {
    console.warn("[bakchod-ai] settings unreadable; running on defaults");
    return null;
  }
}

/** Unseal the stored key, or null if there isn't one or it cannot be read. */
function readSecret(row: Row): string | null {
  return unseal(row, AAD);
}

/**
 * Everything the tick needs, environment and defaults filled in.
 *
 * The chain is the point: every enabled fallback endpoint first, in its own order, then
 * the settings row's key, then the environment's. The last of those three is what the
 * bot ran on before fallbacks existed, and it stays on the end so adding the first
 * fallback cannot break a working bot — only extend it.
 */
export async function loadBotSettings(): Promise<BotSettings> {
  const [row, endpoints] = await Promise.all([loadRow(), loadEndpointCredentials()]);
  const stored = row ? readSecret(row) : null;

  // The panel wins over the environment on all three, which is the whole point of the
  // panel: a gateway that starts refusing requests is something to fix from a phone,
  // not from a laptop with the repo on it.
  const apiKey = stored ?? serverEnv.anthropicKey ?? null;
  const baseUrl = row?.baseUrl ?? serverEnv.anthropicBaseUrl;
  const model = row?.model ?? serverEnv.bakchodModel;

  const candidates: BotCandidate[] = endpoints.map((endpoint) => ({
    id: endpoint.id,
    label: endpoint.label,
    apiKey: endpoint.apiKey,
    // A fallback with no base URL of its own is a second key on the same gateway, and
    // one with no model asks the same model. Only the key has to differ.
    baseUrl: endpoint.baseUrl ?? baseUrl,
    model: endpoint.model ?? model,
  }));

  if (apiKey) candidates.push({ id: null, label: "default", apiKey, baseUrl, model });

  return {
    enabled: row?.enabled ?? BOT_DEFAULTS.enabled,
    commentDelayMinutes: row?.commentDelayMinutes ?? BOT_DEFAULTS.commentDelayMinutes,
    maxCommentsPerTick: row?.maxCommentsPerTick ?? BOT_DEFAULTS.maxCommentsPerTick,
    postIntervalMinutes: row?.postIntervalMinutes ?? BOT_DEFAULTS.postIntervalMinutes,
    pollPercent: row?.pollPercent ?? BOT_DEFAULTS.pollPercent,
    candidates,
  };
}

function sourceOf(stored: string | null, fromEnv: string | undefined): CredentialSource {
  if (stored) return "database";
  return fromEnv ? "environment" : "unset";
}

/**
 * What the admin panel is allowed to know.
 *
 * Note what is absent: no key, no base URL, no model id, and no masked or truncated
 * version of any of them. Only which of the three is set and where it came from,
 * which is what an admin actually needs — "did my change take" — without the page
 * ever being a place a shoulder-surfer can read a credential off.
 */
export async function readBotStatus(): Promise<BotStatus> {
  const row = await loadRow();
  const stored = row ? readSecret(row) : null;

  return {
    enabled: row?.enabled ?? BOT_DEFAULTS.enabled,
    commentDelayMinutes: row?.commentDelayMinutes ?? BOT_DEFAULTS.commentDelayMinutes,
    maxCommentsPerTick: row?.maxCommentsPerTick ?? BOT_DEFAULTS.maxCommentsPerTick,
    postIntervalMinutes: row?.postIntervalMinutes ?? BOT_DEFAULTS.postIntervalMinutes,
    pollPercent: row?.pollPercent ?? BOT_DEFAULTS.pollPercent,
    apiKey: sourceOf(stored, serverEnv.anthropicKey),
    baseUrl: sourceOf(row?.baseUrl ?? null, serverEnv.anthropicBaseUrl),
    // `bakchodModel` always answers, so "unset" would be a lie — an unsaved model is
    // the built-in default, and which id that is stays off the page like the others.
    model: row?.model ? "database" : process.env.BAKCHOD_MODEL ? "environment" : "unset",
    updatedAt: row?.updatedAt.toISOString() ?? null,
    // The one thing on this page that answers "is it running on its own" — and a
    // timestamp cannot leak a credential, which is why it is allowed here at all.
    lastTickAt: row?.lastTickAt?.toISOString() ?? null,
  };
}

export async function saveBotTuning(tuning: BotTuning): Promise<void> {
  await prisma.botSetting.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...tuning },
    update: tuning,
  });
}

/**
 * Take the next background tick, or find out somebody else already has.
 *
 * One conditional UPDATE. A `lastTickAt` older than the window — or never set — means
 * the tick is free, and stamping the new time in the same statement is what makes the
 * claim atomic: `count === 1` is "this process owns the next `windowMs`", and every
 * other runner in that window is told no. See {@link runBackgroundTick} for why the
 * lock is a column rather than a Postgres advisory lock.
 *
 * A failure claims nothing rather than everything. A database that cannot be reached
 * is not a reason to run the bot twice, and the next heartbeat is minutes away.
 */
export async function claimTick(windowMs: number): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  try {
    const { count } = await prisma.botSetting.updateMany({
      where: { id: ROW_ID, OR: [{ lastTickAt: null }, { lastTickAt: { lt: cutoff } }] },
      data: { lastTickAt: now },
    });
    if (count > 0) return true;

    // Nothing matched, which is two different situations: another runner holds the
    // claim, or this database has never had a settings row at all — the table's SQL is
    // run by hand and the row is only written when somebody saves from the panel.
    const exists = await prisma.botSetting.findUnique({
      where: { id: ROW_ID },
      select: { id: true },
    });
    if (exists) return false;

    await prisma.botSetting.create({ data: { id: ROW_ID, lastTickAt: now } });
    return true;
  } catch {
    // A unique violation here is the other container winning the same race, and an
    // unreadable table is a tick that cannot be claimed at all. Both mean: not ours.
    // No error object in the log — this file's rule, and the reason is in `readSecret`.
    console.warn("[tick] not claimed");
    return false;
  }
}

/** Shaped to be valid for both halves of an upsert, so one object serves both. */
type CredentialWrite = Partial<SealedWrite> & {
  baseUrl?: string | null;
  model?: string | null;
};

/**
 * Apply a credential patch. Absent fields are left alone; empty ones are cleared
 * back to the environment.
 *
 * Throws if `MEDIA_MASTER_KEY` is missing or malformed, which is the right answer:
 * storing a key in plaintext because the master key was not configured is not a
 * degraded mode worth having.
 */
export async function saveBotCredentials(patch: BotCredentials): Promise<void> {
  const data: CredentialWrite = {};

  if (patch.apiKey !== undefined) {
    // `SHREDDED` nulls all six columns: the old ciphertext is gone, not merely ignored.
    Object.assign(data, patch.apiKey === "" ? SHREDDED : seal(patch.apiKey, AAD));
  }
  if (patch.baseUrl !== undefined) data.baseUrl = patch.baseUrl || null;
  if (patch.model !== undefined) data.model = patch.model || null;

  if (Object.keys(data).length === 0) return;

  await prisma.botSetting.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...data },
    update: data,
  });
}
