import "server-only";

/**
 * Internet Archive S3-like (IAS3) storage adapter.
 *
 * Notes that shaped this implementation, from archive.org/developers/ias3.html:
 *
 *  - Auth is the simplified `Authorization: LOW <accesskey>:<secret>` scheme.
 *    The secret travels in the header, so HTTPS is mandatory.
 *  - `x-archive-queue-derive:0` is important for us. Derives generate
 *    web-viewable secondary files, which is meaningless work for an opaque
 *    encrypted blob and would waste Archive's compute.
 *  - Uploads land in temporary storage and are ingested asynchronously, so a
 *    file is NOT immediately readable back. The disk cache in front of this
 *    covers that window; posts never wait on it.
 *  - The Archive returns 307s more often than S3 does, and clients must resend
 *    the Authorization header to the redirect target (curl needs
 *    --location-trusted for exactly this). Node's fetch drops auth headers on
 *    cross-origin redirects, so we follow redirects manually below.
 *  - Items are grouped by day rather than one-per-post. Creating an item per
 *    upload would litter a public library with thousands of tiny items.
 */

import { serverEnv } from "../config";
import type { PutOptions, StorageAdapter, StoredLocator } from "./index";

const S3_ENDPOINT = "https://s3.us.archive.org";
const DOWNLOAD_ENDPOINT = "https://archive.org/download";
const MAX_REDIRECTS = 4;

/** IA identifiers: start alphanumeric, then [A-Za-z0-9._-], 5–100 chars. */
function sanitizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  const padded = cleaned.length >= 5 ? cleaned : `${cleaned}-item`;
  return padded.slice(0, 100);
}

/** One item per UTC day keeps the item count sane. */
export function itemIdFor(date: Date, prefix: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return sanitizeIdentifier(`${prefix}-${y}${m}${d}`);
}

export class ArchiveOrgAdapter implements StorageAdapter {
  readonly name = "archive.org";

  private authHeader(): string {
    const { accessKey, secretKey } = serverEnv.archive;
    return `LOW ${accessKey}:${secretKey}`;
  }

  /**
   * Follow redirects by hand, re-sending the Authorization header and body to
   * the new target. This is the fetch equivalent of curl --location-trusted.
   */
  private async requestFollowing(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
  ): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, { ...init, redirect: "manual" });
      if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
        const location = res.headers.get("location");
        if (!location) return res;
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    throw new Error(`Too many redirects from Archive for ${url}`);
  }

  async isOverLimit(item: string): Promise<boolean> {
    const { accessKey } = serverEnv.archive;
    const url =
      `${S3_ENDPOINT}/?check_limit=1` +
      `&accesskey=${encodeURIComponent(accessKey)}` +
      `&bucket=${encodeURIComponent(item)}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) return false; // Check unavailable: proceed and let the PUT decide.
      const body = (await res.json()) as { over_limit?: number | string };
      return String(body.over_limit ?? "0") === "1";
    } catch {
      return false;
    }
  }

  async put(key: string, data: Buffer, opts: PutOptions): Promise<StoredLocator> {
    const item = itemIdFor(new Date(), serverEnv.archive.itemPrefix);
    const file = `${key}.enc`;

    const headers: Record<string, string> = {
      authorization: this.authHeader(),
      "content-type": "application/octet-stream",
      "content-length": String(data.byteLength),
      // Creates the item on first write; a no-op once it exists.
      "x-archive-auto-make-bucket": "1",
      // Do not spend Archive's compute deriving an encrypted blob.
      "x-archive-queue-derive": "0",
      "x-archive-meta-mediatype": "data",
      "x-archive-meta-collection": "opensource_media",
      "x-archive-meta-title": opts.title,
      "x-archive-size-hint": String(opts.size),
    };

    const res = await this.requestFollowing(`${S3_ENDPOINT}/${item}/${file}`, {
      method: "PUT",
      headers,
      body: new Uint8Array(data),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 503 SlowDown is retryable; the worker backs off and tries again.
      throw new ArchiveUploadError(
        `Archive upload failed (${res.status}): ${detail.slice(0, 300)}`,
        res.status,
        res.status === 503 || res.status >= 500,
      );
    }

    return { item, file };
  }

  async get(locator: StoredLocator): Promise<Buffer> {
    // Downloads go through the web infrastructure, which the docs note is the
    // high-performance path, and needs no credentials — the blob is encrypted.
    const url = `${DOWNLOAD_ENDPOINT}/${locator.item}/${locator.file}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      throw new ArchiveUploadError(
        `Archive download failed (${res.status}) for ${locator.item}/${locator.file}`,
        res.status,
        res.status === 404 || res.status >= 500,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async head(locator: StoredLocator): Promise<boolean> {
    const url = `${DOWNLOAD_ENDPOINT}/${locator.item}/${locator.file}`;
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class ArchiveUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ArchiveUploadError";
  }
}
