import "server-only";

/**
 * Archive upload worker.
 *
 * Posts go live off the disk cache the instant they are created; pushing the
 * ciphertext to Internet Archive happens here, behind them. Two things shape
 * the design:
 *
 *  - **The spool is on disk, not in memory.** Holding pending ciphertext in a
 *    process-local array would lose uploads on restart and balloon memory on a
 *    burst. Files under `.spool/<postId>/` survive both, and a sweep at startup
 *    picks up anything left behind.
 *  - **Backpressure before bytes.** The archive answers `over_limit` when an
 *    account is pushing too hard. Checking that first is much cheaper than
 *    discovering it via a 503 after uploading a 40 MB body.
 *
 * State moves PENDING -> UPLOADING -> UPLOADED -> VERIFIED. VERIFIED means a
 * HEAD on the public download URL succeeded, which is the first moment the file
 * is genuinely readable back — archive ingestion is asynchronous and lags the
 * upload by minutes.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "../lib/config";
import { prisma } from "../lib/prisma";
import { getStorage } from "../lib/storage";
import { ArchiveUploadError } from "../lib/storage/archive";
import type { PendingUpload } from "../lib/media/store";

const SPOOL_ROOT = path.join(serverEnv.dataDir, ".spool");
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 4;

function spoolDir(postId: string): string {
  // Post ids are cuids, but never build a path from unvalidated input.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(postId)) {
    throw new Error(`Unsafe post id: ${postId}`);
  }
  return path.join(SPOOL_ROOT, postId);
}

async function writeSpool(postId: string, uploads: PendingUpload[]): Promise<void> {
  const dir = spoolDir(postId);
  await mkdir(dir, { recursive: true });
  await Promise.all(
    uploads.map((u) => writeFile(path.join(dir, `${u.key}.enc`), u.ciphertext)),
  );
}

async function readSpool(postId: string): Promise<PendingUpload[]> {
  const dir = spoolDir(postId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return Promise.all(
    names
      .filter((n) => n.endsWith(".enc"))
      .map(async (n) => ({
        key: n.slice(0, -4),
        ciphertext: await readFile(path.join(dir, n)),
      })),
  );
}

async function clearSpool(postId: string): Promise<void> {
  await rm(spoolDir(postId), { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Draining
// ---------------------------------------------------------------------------

let draining = false;
let drainQueued = false;

/** Called after a post is created. Never awaited by the request path. */
export function enqueueArchiveUpload(
  postId: string,
  uploads: PendingUpload[],
): void {
  void writeSpool(postId, uploads)
    .then(() => kickWorker())
    .catch((err) => {
      console.error(`[archive] failed to spool post ${postId}:`, err);
    });
}

/** Start a drain if one is not already running; coalesce concurrent kicks. */
export function kickWorker(): void {
  if (draining) {
    drainQueued = true;
    return;
  }
  void runDrain();
}

async function runDrain(): Promise<void> {
  draining = true;
  try {
    do {
      drainQueued = false;
      await drainOnce();
    } while (drainQueued);
  } catch (err) {
    console.error("[archive] drain failed:", err);
  } finally {
    draining = false;
  }
}

/** One pass: upload a batch of pending posts, then verify a batch of uploaded ones. */
export async function drainOnce(): Promise<{ uploaded: number; verified: number }> {
  const storage = getStorage();

  const pending = await prisma.post.findMany({
    where: {
      archiveState: { in: ["PENDING", "UPLOADING"] },
      uploadAttempts: { lt: MAX_ATTEMPTS },
      storageKey: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, storageKey: true, uploadAttempts: true, bytes: true },
  });

  let uploaded = 0;

  for (const post of pending) {
    const uploads = await readSpool(post.id);
    if (uploads.length === 0) {
      // Nothing to send. Either it was already uploaded and the row did not get
      // updated, or the spool was wiped. Flag it rather than looping forever.
      await prisma.post.update({
        where: { id: post.id },
        data: {
          archiveState: "FAILED",
          archiveError: "Spooled ciphertext is missing; nothing to upload.",
          uploadAttempts: MAX_ATTEMPTS,
        },
      });
      continue;
    }

    // Ask before pushing. Uploading into a rate limit wastes the whole body.
    if (storage.isOverLimit) {
      const mainKey = post.storageKey!;
      const throttled = await storage.isOverLimit(mainKey);
      if (throttled) {
        console.warn("[archive] backend is over limit; pausing this pass");
        break;
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { archiveState: "UPLOADING", uploadAttempts: { increment: 1 } },
    });

    try {
      let mainLocator: { item: string; file: string } | null = null;
      for (const upload of uploads) {
        const locator = await storage.put(upload.key, upload.ciphertext, {
          size: upload.ciphertext.byteLength,
          // Deliberately generic: item metadata is public, so no user content.
          title: `Rate the Bakchod encrypted media ${upload.key}`,
        });
        if (upload.key === post.storageKey) mainLocator = locator;
      }

      await prisma.post.update({
        where: { id: post.id },
        data: {
          archiveState: "UPLOADED",
          archiveItem: mainLocator?.item ?? null,
          archiveFile: mainLocator?.file ?? null,
          archiveError: null,
        },
      });
      await clearSpool(post.id);
      uploaded++;
    } catch (err) {
      const retryable = err instanceof ArchiveUploadError ? err.retryable : true;
      const attempts = post.uploadAttempts + 1;
      const exhausted = !retryable || attempts >= MAX_ATTEMPTS;

      await prisma.post.update({
        where: { id: post.id },
        data: {
          // Keep it PENDING while retries remain so the next pass picks it up.
          archiveState: exhausted ? "FAILED" : "PENDING",
          archiveError: String(err instanceof Error ? err.message : err).slice(0, 500),
        },
      });

      console.error(
        `[archive] upload failed for post ${post.id} (attempt ${attempts}):`,
        err,
      );
      if (!retryable) break;
    }
  }

  const verified = await verifyUploaded();
  return { uploaded, verified };
}

/**
 * Promote UPLOADED -> VERIFIED once the file is actually readable back. Until
 * this flips, the disk cache is the only source for that media.
 */
export async function verifyUploaded(): Promise<number> {
  const storage = getStorage();
  const candidates = await prisma.post.findMany({
    where: { archiveState: "UPLOADED", archiveItem: { not: null } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, archiveItem: true, archiveFile: true },
  });

  let verified = 0;
  for (const post of candidates) {
    const exists = await storage.head({
      item: post.archiveItem!,
      file: post.archiveFile ?? "",
    });
    if (!exists) continue; // Still ingesting; check again next pass.
    await prisma.post.update({
      where: { id: post.id },
      data: { archiveState: "VERIFIED", archiveError: null },
    });
    verified++;
  }
  return verified;
}

/** Requeue anything the process was in the middle of when it last stopped. */
export async function recoverStuckUploads(): Promise<number> {
  const { count } = await prisma.post.updateMany({
    where: { archiveState: "UPLOADING" },
    data: { archiveState: "PENDING" },
  });
  if (count > 0) kickWorker();
  return count;
}

/**
 * Retry a post that gave up. Resets the attempt counter, so this is the manual
 * escape hatch for a transient outage that outlasted the backoff.
 */
export async function retryFailed(postId: string): Promise<void> {
  await prisma.post.update({
    where: { id: postId },
    data: { archiveState: "PENDING", uploadAttempts: 0, archiveError: null },
  });
  kickWorker();
}
