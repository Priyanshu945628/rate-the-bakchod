import "server-only";

/**
 * Durable storage for encrypted media.
 *
 * Only ciphertext ever reaches an adapter — encryption happens upstream in the
 * media pipeline, so a storage backend never sees plaintext or a key. That is
 * what makes it safe to keep blobs on a public host like Internet Archive.
 */

export interface PutOptions {
  /** Byte length, sent to the backend as a size hint where supported. */
  size: number;
  /** Human-readable label for the archive item. Never contains user content. */
  title: string;
}

export interface StoredLocator {
  /** Archive item identifier / bucket. */
  item: string;
  /** File name within the item. */
  file: string;
}

export interface StorageAdapter {
  readonly name: string;
  /** Upload ciphertext. Resolves once the backend has accepted the bytes. */
  put(key: string, data: Buffer, opts: PutOptions): Promise<StoredLocator>;
  /** Fetch ciphertext back. Throws if not (yet) retrievable. */
  get(locator: StoredLocator): Promise<Buffer>;
  /** Cheap existence check, used to promote UPLOADED -> VERIFIED. */
  head(locator: StoredLocator): Promise<boolean>;
  /**
   * Whether the backend is currently asking us to slow down. Checked before
   * each upload so we apply backpressure instead of hammering into 503s.
   */
  isOverLimit?(item: string): Promise<boolean>;
}

import { serverEnv } from "../config";
import { ArchiveOrgAdapter } from "./archive";
import { LocalDiskAdapter } from "./disk";

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  cached =
    serverEnv.storageDriver === "disk"
      ? new LocalDiskAdapter()
      : new ArchiveOrgAdapter();
  return cached;
}

/** Test seam — lets suites swap in a fake without touching the environment. */
export function __setStorageForTests(adapter: StorageAdapter | null): void {
  cached = adapter;
}
