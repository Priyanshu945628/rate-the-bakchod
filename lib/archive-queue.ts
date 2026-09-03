import "server-only";

/**
 * Indirection so `lib/posts.ts` does not import the worker directly.
 *
 * Without this seam, importing the post service would pull in the whole upload
 * machinery — and the test suite along with it would need a live archive
 * backend just to create a row.
 */

import type { PendingUpload } from "./media/store";

export function enqueueArchiveUpload(
  postId: string,
  uploads: PendingUpload[],
): void {
  // Loaded lazily and deliberately not awaited: the request returns as soon as
  // the post row exists, and the upload proceeds in the background.
  void import("../worker/archive-uploader")
    .then((worker) => worker.enqueueArchiveUpload(postId, uploads))
    .catch((err) => {
      console.error("[archive] could not enqueue upload:", err);
    });
}
