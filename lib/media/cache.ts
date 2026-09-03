import "server-only";

/**
 * Plaintext derivative cache on local disk.
 *
 * This is not merely a speed optimisation. Internet Archive ingests uploads
 * asynchronously — a file is not readable back for some minutes after a PUT —
 * so in the window right after posting, this cache is the only place the media
 * exists in servable form. Posts go live off it immediately and the archive
 * upload happens behind them.
 *
 * Entries are content-addressed, so they are immutable and safe to serve with
 * long-lived cache headers. Eviction is LRU by mtime, bounded by cacheMaxBytes.
 */

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { limits, serverEnv } from "../config";

const CACHE_ROOT = path.join(serverEnv.dataDir, ".cache", "media");

/** Reject anything that could escape the cache directory. */
function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    throw new Error(`Unsafe cache key: ${key}`);
  }
}

export function cachePathFor(key: string): string {
  assertSafeKey(key);
  return path.join(CACHE_ROOT, key);
}

export async function cacheHas(key: string): Promise<boolean> {
  try {
    await stat(cachePathFor(key));
    return true;
  } catch {
    return false;
  }
}

export async function cacheSize(key: string): Promise<number | null> {
  try {
    return (await stat(cachePathFor(key))).size;
  } catch {
    return null;
  }
}

/** Mark an entry as recently used, so eviction sees it as hot. */
export async function cacheTouch(key: string): Promise<void> {
  const now = new Date();
  try {
    await utimes(cachePathFor(key), now, now);
  } catch {
    /* entry vanished; nothing to touch */
  }
}

export async function cacheRead(key: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(cachePathFor(key));
    void cacheTouch(key);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Write atomically: a partially written file must never be served, which could
 * otherwise happen if two requests miss the cache for the same key at once.
 */
export async function cacheWrite(key: string, data: Buffer): Promise<void> {
  const dest = cachePathFor(key);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, dest);
  void evictIfNeeded();
}

export function cacheStream(key: string, start?: number, end?: number) {
  return createReadStream(cachePathFor(key), { start, end });
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await unlink(cachePathFor(key));
  } catch {
    /* already gone */
  }
}

let evicting = false;

/** Drop least-recently-used entries until the cache is back under its ceiling. */
export async function evictIfNeeded(): Promise<number> {
  if (evicting) return 0;
  evicting = true;
  try {
    let entries: string[];
    try {
      entries = await readdir(CACHE_ROOT);
    } catch {
      return 0;
    }

    const stats = await Promise.all(
      entries
        .filter((n) => !n.endsWith(".tmp"))
        .map(async (name) => {
          try {
            const s = await stat(path.join(CACHE_ROOT, name));
            return { name, size: s.size, mtime: s.mtimeMs };
          } catch {
            return null;
          }
        }),
    );

    const live = stats.filter((s): s is NonNullable<typeof s> => s !== null);
    let total = live.reduce((sum, s) => sum + s.size, 0);
    if (total <= limits.cacheMaxBytes) return 0;

    live.sort((a, b) => a.mtime - b.mtime); // oldest first
    let removed = 0;
    for (const entry of live) {
      if (total <= limits.cacheMaxBytes) break;
      try {
        await unlink(path.join(CACHE_ROOT, entry.name));
        total -= entry.size;
        removed++;
      } catch {
        /* raced with another eviction */
      }
    }
    return removed;
  } finally {
    evicting = false;
  }
}
