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
 * The key is sealed with the same envelope as media: a per-row data key encrypts the
 * value, `MEDIA_MASTER_KEY` wraps the data key. That means the master key is the only
 * thing standing between a database dump and the key — which is already true of every
 * uploaded photo, so it is one secret to protect rather than two.
 */

import { serverEnv } from "../config";
import { prisma } from "../prisma";
import {
  decryptContent,
  encryptContent,
  generateDek,
  loadMasterKey,
  unwrapDek,
  wrapDek,
} from "../crypto";
import { canRenderText } from "./card";
import { toBytes } from "../media/store";
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
 * replayed against another, and here there is no other row to replay it into.
 */
const AAD = "bot-setting";

export interface BotSettings extends BotTuning {
  /** Null means no key anywhere — the bot runs on canned lines. */
  apiKey: string | null;
  /** Undefined means api.anthropic.com; the SDK takes it as a default. */
  baseUrl: string | undefined;
  model: string;
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
  const { secretCipher, secretIv, secretTag, wrappedKey, keyIv, keyTag } = row;
  if (!secretCipher || !secretIv || !secretTag) return null;
  if (!wrappedKey || !keyIv || !keyTag) return null;

  try {
    const dek = unwrapDek(
      {
        ciphertext: Buffer.from(wrappedKey),
        iv: Buffer.from(keyIv),
        tag: Buffer.from(keyTag),
      },
      loadMasterKey(serverEnv.mediaMasterKey),
      AAD,
    );
    return decryptContent(
      {
        ciphertext: Buffer.from(secretCipher),
        iv: Buffer.from(secretIv),
        tag: Buffer.from(secretTag),
      },
      dek,
    ).toString("utf8");
  } catch {
    // No error object in the log. The only ways this fails are a rotated master key
    // or a tampered row, and neither is worth the chance of a fragment of key
    // material reaching a log file somebody pastes into a chat.
    console.error(
      "[bakchod-ai] the saved API key could not be decrypted — falling back to the environment. Re-enter it in the admin panel.",
    );
    return null;
  }
}

/** Everything the tick needs, environment and defaults filled in. */
export async function loadBotSettings(): Promise<BotSettings> {
  const row = await loadRow();
  const stored = row ? readSecret(row) : null;

  return {
    enabled: row?.enabled ?? BOT_DEFAULTS.enabled,
    commentDelayMinutes: row?.commentDelayMinutes ?? BOT_DEFAULTS.commentDelayMinutes,
    maxCommentsPerTick: row?.maxCommentsPerTick ?? BOT_DEFAULTS.maxCommentsPerTick,
    postIntervalMinutes: row?.postIntervalMinutes ?? BOT_DEFAULTS.postIntervalMinutes,
    cardPercent: row?.cardPercent ?? BOT_DEFAULTS.cardPercent,
    // The panel wins over the environment on all three, which is the whole point of
    // the panel: a gateway that starts refusing requests is something to fix from a
    // phone, not from a laptop with the repo on it.
    apiKey: stored ?? serverEnv.anthropicKey ?? null,
    baseUrl: row?.baseUrl ?? serverEnv.anthropicBaseUrl,
    model: row?.model ?? serverEnv.bakchodModel,
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
  const [row, canRenderCards] = await Promise.all([loadRow(), canRenderText()]);
  const stored = row ? readSecret(row) : null;

  return {
    enabled: row?.enabled ?? BOT_DEFAULTS.enabled,
    commentDelayMinutes: row?.commentDelayMinutes ?? BOT_DEFAULTS.commentDelayMinutes,
    maxCommentsPerTick: row?.maxCommentsPerTick ?? BOT_DEFAULTS.maxCommentsPerTick,
    postIntervalMinutes: row?.postIntervalMinutes ?? BOT_DEFAULTS.postIntervalMinutes,
    cardPercent: row?.cardPercent ?? BOT_DEFAULTS.cardPercent,
    apiKey: sourceOf(stored, serverEnv.anthropicKey),
    baseUrl: sourceOf(row?.baseUrl ?? null, serverEnv.anthropicBaseUrl),
    // `bakchodModel` always answers, so "unset" would be a lie — an unsaved model is
    // the built-in default, and which id that is stays off the page like the others.
    model: row?.model ? "database" : process.env.BAKCHOD_MODEL ? "environment" : "unset",
    updatedAt: row?.updatedAt.toISOString() ?? null,
    canRenderCards,
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
 * Shaped to be valid for both halves of an upsert, so one object serves both.
 *
 * `Uint8Array<ArrayBuffer>` rather than `Buffer` for the same reason the media write
 * path uses it — see {@link toBytes}.
 */
type CredentialWrite = {
  secretCipher?: Uint8Array<ArrayBuffer> | null;
  secretIv?: Uint8Array<ArrayBuffer> | null;
  secretTag?: Uint8Array<ArrayBuffer> | null;
  wrappedKey?: Uint8Array<ArrayBuffer> | null;
  keyIv?: Uint8Array<ArrayBuffer> | null;
  keyTag?: Uint8Array<ArrayBuffer> | null;
  baseUrl?: string | null;
  model?: string | null;
};

function sealSecret(value: string): CredentialWrite {
  const dek = generateDek();
  const sealed = encryptContent(Buffer.from(value, "utf8"), dek);
  const wrapped = wrapDek(dek, loadMasterKey(serverEnv.mediaMasterKey), AAD);
  return {
    secretCipher: toBytes(sealed.ciphertext),
    secretIv: toBytes(sealed.iv),
    secretTag: toBytes(sealed.tag),
    wrappedKey: toBytes(wrapped.ciphertext),
    keyIv: toBytes(wrapped.iv),
    keyTag: toBytes(wrapped.tag),
  };
}

/** Nulling all six is the shred: the old ciphertext is gone, not merely ignored. */
const CLEARED: CredentialWrite = {
  secretCipher: null,
  secretIv: null,
  secretTag: null,
  wrappedKey: null,
  keyIv: null,
  keyTag: null,
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
    Object.assign(data, patch.apiKey === "" ? CLEARED : sealSecret(patch.apiKey));
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
