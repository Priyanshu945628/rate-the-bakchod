import "server-only";

/**
 * The envelope every stored bot credential lives in.
 *
 * Six columns per secret: the value encrypted under a per-row data key, and that data
 * key wrapped under `MEDIA_MASTER_KEY`. The same scheme as media, so the master key is
 * the one secret standing between a database dump and everything in it, rather than one
 * more secret to keep somewhere else.
 *
 * The **AAD is the caller's**, and that is the whole reason this file exists separately
 * from its two callers. `BotSetting` is a single row and passes a constant; each
 * `BotEndpoint` passes its own id, because there a wrapped key lifted out of one row
 * would otherwise decrypt perfectly well pasted into another — swapping the key that
 * gets tried first for the one an attacker controls.
 */

import { serverEnv } from "../config";
import {
  decryptContent,
  encryptContent,
  generateDek,
  loadMasterKey,
  unwrapDek,
  wrapDek,
} from "../crypto";
import { toBytes } from "../media/store";

/** The six columns as Prisma hands them back. */
export interface SealedRow {
  secretCipher: Uint8Array | null;
  secretIv: Uint8Array | null;
  secretTag: Uint8Array | null;
  wrappedKey: Uint8Array | null;
  keyIv: Uint8Array | null;
  keyTag: Uint8Array | null;
}

/**
 * The six columns on the way in.
 *
 * `Uint8Array<ArrayBuffer>` rather than `Buffer` for the same reason the media write
 * path uses it — see {@link toBytes} — and every field present so one object is valid
 * for both halves of an upsert.
 */
export type SealedWrite = { [K in keyof SealedRow]: Uint8Array<ArrayBuffer> | null };

/**
 * Seal a value under `aad`.
 *
 * Throws `MasterKeyError` when `MEDIA_MASTER_KEY` is missing or malformed, which is the
 * right answer: storing a key in plaintext because the master key was not configured is
 * not a degraded mode worth having.
 */
export function seal(value: string, aad: string): SealedWrite {
  const dek = generateDek();
  const sealed = encryptContent(Buffer.from(value, "utf8"), dek);
  const wrapped = wrapDek(dek, loadMasterKey(serverEnv.mediaMasterKey), aad);
  return {
    secretCipher: toBytes(sealed.ciphertext),
    secretIv: toBytes(sealed.iv),
    secretTag: toBytes(sealed.tag),
    wrappedKey: toBytes(wrapped.ciphertext),
    keyIv: toBytes(wrapped.iv),
    keyTag: toBytes(wrapped.tag),
  };
}

/** Nulling all six is a shred: the old ciphertext is gone, not merely ignored. */
export const SHREDDED: SealedWrite = {
  secretCipher: null,
  secretIv: null,
  secretTag: null,
  wrappedKey: null,
  keyIv: null,
  keyTag: null,
};

/** Whether a row is carrying a secret at all, without unsealing it. */
export function isSealed(row: SealedRow): boolean {
  return Boolean(
    row.secretCipher && row.secretIv && row.secretTag && row.wrappedKey && row.keyIv && row.keyTag,
  );
}

/**
 * Unseal a row's secret, or null when there isn't one or it cannot be read.
 *
 * Null rather than a throw, because both callers have somewhere better to go: the
 * settings row falls through to the environment, and an endpoint falls through to the
 * next endpoint. A key that cannot be decrypted is a key that is not there.
 */
export function unseal(row: SealedRow, aad: string): string | null {
  if (!isSealed(row)) return null;

  try {
    const dek = unwrapDek(
      {
        ciphertext: Buffer.from(row.wrappedKey!),
        iv: Buffer.from(row.keyIv!),
        tag: Buffer.from(row.keyTag!),
      },
      loadMasterKey(serverEnv.mediaMasterKey),
      aad,
    );
    return decryptContent(
      {
        ciphertext: Buffer.from(row.secretCipher!),
        iv: Buffer.from(row.secretIv!),
        tag: Buffer.from(row.secretTag!),
      },
      dek,
    ).toString("utf8");
  } catch {
    // No error object in the log, and no label either. The only ways this fails are a
    // rotated master key or a tampered row, and neither is worth the chance of a
    // fragment of key material reaching a log file somebody pastes into a chat.
    console.error(
      "[bakchod-ai] a stored API key could not be decrypted, so it is being skipped. Re-enter it in the admin panel.",
    );
    return null;
  }
}
