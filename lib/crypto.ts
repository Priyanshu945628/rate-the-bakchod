import "server-only";

/**
 * Envelope encryption for user media.
 *
 * Every file gets its own random 32-byte data key (DEK) and is encrypted with
 * AES-256-GCM. The DEK is then itself encrypted ("wrapped") with the long-lived
 * MEDIA_MASTER_KEY and stored alongside the row. The master key never leaves
 * this process and is never written to disk or to the archive.
 *
 * Why it matters here: ciphertext goes to Internet Archive, which has no delete.
 * Destroying the wrapped DEK (crypto-shred) is therefore the only real way to
 * make an archived file unrecoverable, and it is instant and irreversible.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/** Parse and validate the base64 master key from the environment. */
export function loadMasterKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      "MEDIA_MASTER_KEY is not set. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("MEDIA_MASTER_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MEDIA_MASTER_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/** A fresh per-file data key. */
export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

function seal(plaintext: Buffer, key: Buffer, aad?: Buffer): Sealed {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function open(sealed: Sealed, key: Buffer, aad?: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  if (sealed.tag.length !== TAG_BYTES) {
    throw new Error(`Auth tag must be ${TAG_BYTES} bytes.`);
  }
  const decipher = createDecipheriv(ALGO, key, sealed.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  // Throws if the tag does not verify — i.e. the data was tampered with.
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

/** Encrypt file bytes under a per-file DEK. */
export function encryptContent(plaintext: Buffer, dek: Buffer): Sealed {
  return seal(plaintext, dek);
}

/** Decrypt file bytes. Throws if the ciphertext or tag was altered. */
export function decryptContent(sealed: Sealed, dek: Buffer): Buffer {
  return open(sealed, dek);
}

/**
 * Wrap a DEK with the master key. The storage key is bound in as additional
 * authenticated data, so a wrapped key lifted from one row cannot be replayed
 * against another row.
 */
export function wrapDek(dek: Buffer, masterKey: Buffer, storageKey: string): Sealed {
  return seal(dek, masterKey, Buffer.from(storageKey, "utf8"));
}

/** Recover a DEK. Throws if the row was shredded, tampered with, or mismatched. */
export function unwrapDek(
  sealed: Sealed,
  masterKey: Buffer,
  storageKey: string,
): Buffer {
  return open(sealed, masterKey, Buffer.from(storageKey, "utf8"));
}

/** Constant-time compare, for comparing secrets such as the cron token. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
