import "server-only";

/**
 * The bridge between normalised media and durable storage.
 *
 * Write path: encrypt under a fresh DEK, wrap the DEK with the master key, drop
 * the *plaintext* into the disk cache so the post can go live immediately, and
 * hand back the columns to persist. The ciphertext is uploaded to the archive
 * later, by the worker.
 *
 * Read path: serve from cache; on a miss, pull ciphertext from the archive,
 * unwrap, decrypt, and refill the cache.
 */

import { randomBytes } from "node:crypto";
import { serverEnv } from "../config";
import {
  decryptContent,
  encryptContent,
  generateDek,
  loadMasterKey,
  unwrapDek,
  wrapDek,
  type Sealed,
} from "../crypto";
import { getStorage } from "../storage";
import { cacheRead, cacheWrite } from "./cache";
import type { NormalizedMedia } from "./pipeline";

/**
 * Prisma's `Bytes` columns want an ArrayBuffer-backed Uint8Array, while Node's
 * Buffer is typed over ArrayBufferLike. Copying into a fresh view satisfies the
 * type and detaches from any pooled Buffer memory.
 */
export function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/** Exactly the columns the write path produces. */
export interface SealedMediaColumns {
  storageKey: string;
  wrappedKey: Uint8Array<ArrayBuffer>;
  keyIv: Uint8Array<ArrayBuffer>;
  keyTag: Uint8Array<ArrayBuffer>;
  contentIv: Uint8Array<ArrayBuffer>;
  contentTag: Uint8Array<ArrayBuffer>;
  posterKey: string | null;
  posterIv: Uint8Array<ArrayBuffer> | null;
  posterTag: Uint8Array<ArrayBuffer> | null;
  mimeType: string;
  sha256: string;
  phash: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number;
}

/** Ciphertext waiting to be pushed to the archive. */
export interface PendingUpload {
  key: string;
  ciphertext: Buffer;
}

export interface SealedMedia {
  columns: SealedMediaColumns;
  uploads: PendingUpload[];
}

/**
 * A fresh, unguessable storage key. Also used for profile assets: because the key
 * is never reused, replacing an image yields a new URL, which is what lets those
 * responses be cached `immutable`.
 */
export function newStorageKey(): string {
  return randomBytes(16).toString("hex");
}

export async function sealMedia(media: NormalizedMedia): Promise<SealedMedia> {
  const masterKey = loadMasterKey(serverEnv.mediaMasterKey);
  const dek = generateDek();
  const storageKey = newStorageKey();

  const content = encryptContent(media.data, dek);
  const wrapped = wrapDek(dek, masterKey, storageKey);

  const uploads: PendingUpload[] = [
    { key: storageKey, ciphertext: content.ciphertext },
  ];

  let posterKey: string | null = null;
  let posterSealed: Sealed | null = null;
  if (media.poster) {
    posterKey = `${storageKey}p`;
    posterSealed = encryptContent(media.poster, dek);
    uploads.push({ key: posterKey, ciphertext: posterSealed.ciphertext });
  }

  // Cache the plaintext before returning: the feed reads from here for the
  // several minutes the archive takes to ingest.
  await cacheWrite(storageKey, media.data);
  if (posterKey && media.poster) await cacheWrite(posterKey, media.poster);

  // The DEK has done its job; drop the plaintext key from memory promptly.
  dek.fill(0);

  return {
    columns: {
      storageKey,
      wrappedKey: toBytes(wrapped.ciphertext),
      keyIv: toBytes(wrapped.iv),
      keyTag: toBytes(wrapped.tag),
      contentIv: toBytes(content.iv),
      contentTag: toBytes(content.tag),
      posterKey,
      posterIv: posterSealed ? toBytes(posterSealed.iv) : null,
      posterTag: posterSealed ? toBytes(posterSealed.tag) : null,
      mimeType: media.mimeType,
      sha256: media.sha256,
      phash: media.phash,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      bytes: media.bytes,
    },
    uploads,
  };
}

/** The subset of a Post row needed to read media back. */
export interface MediaRow {
  storageKey: string | null;
  archiveItem: string | null;
  archiveFile: string | null;
  wrappedKey: Uint8Array | null;
  keyIv: Uint8Array | null;
  keyTag: Uint8Array | null;
  contentIv: Uint8Array | null;
  contentTag: Uint8Array | null;
  posterKey: string | null;
  posterIv: Uint8Array | null;
  posterTag: Uint8Array | null;
}

export class ShreddedError extends Error {
  constructor() {
    super("This media was deleted and its key destroyed.");
    this.name = "ShreddedError";
  }
}

export class NotYetAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotYetAvailableError";
  }
}

/**
 * Plaintext bytes for a post's main file or its poster.
 * Returns from cache when possible; otherwise decrypts from the archive.
 */
export async function readMedia(
  row: MediaRow,
  which: "main" | "poster" = "main",
): Promise<Buffer> {
  const key = which === "poster" ? row.posterKey : row.storageKey;
  if (!key) throw new NotYetAvailableError("No media on this post.");

  const cached = await cacheRead(key);
  if (cached) return cached;

  // A null wrappedKey is a crypto-shred. The archived ciphertext still exists
  // but nothing can ever decrypt it again — that is the point.
  if (!row.wrappedKey || !row.keyIv || !row.keyTag) throw new ShreddedError();

  const iv = which === "poster" ? row.posterIv : row.contentIv;
  const tag = which === "poster" ? row.posterTag : row.contentTag;
  if (!iv || !tag) throw new NotYetAvailableError("Media is missing its crypto header.");

  if (!row.archiveItem) {
    // Cache miss before the archive upload finished. Rare, but possible if the
    // cache was evicted or wiped while a post was still PENDING.
    throw new NotYetAvailableError(
      "This media is still being archived. Try again in a minute.",
    );
  }

  const masterKey = loadMasterKey(serverEnv.mediaMasterKey);
  const dek = unwrapDek(
    {
      ciphertext: Buffer.from(row.wrappedKey),
      iv: Buffer.from(row.keyIv),
      tag: Buffer.from(row.keyTag),
    },
    masterKey,
    // AAD is always the main storage key, even for the poster — one DEK, one
    // binding.
    row.storageKey ?? "",
  );

  try {
    const ciphertext = await getStorage().get({
      item: row.archiveItem,
      file: `${key}.enc`,
    });
    const plaintext = decryptContent(
      { ciphertext, iv: Buffer.from(iv), tag: Buffer.from(tag) },
      dek,
    );
    await cacheWrite(key, plaintext);
    return plaintext;
  } finally {
    dek.fill(0);
  }
}
