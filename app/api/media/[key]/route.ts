import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cacheSize, cacheStream } from "@/lib/media/cache";
import { isStoryLive } from "@/lib/story-window";
import {
  NotYetAvailableError,
  ShreddedError,
  readMedia,
  type MediaRow,
} from "@/lib/media/store";

export const runtime = "nodejs";
// Bytes come off the disk cache or the archive; there is nothing for Next to
// prerender here.
export const dynamic = "force-dynamic";

const MEDIA_SELECT = {
  isHidden: true,
  mimeType: true,
  storageKey: true,
  archiveItem: true,
  archiveFile: true,
  wrappedKey: true,
  keyIv: true,
  keyTag: true,
  contentIv: true,
  contentTag: true,
  posterKey: true,
  posterIv: true,
  posterTag: true,
  isStory: true,
  storyExpiresAt: true,
  highlightId: true,
} as const;

/** `bytes=start-end`, with either side optional. Returns null if unparseable. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const wantPoster = new URL(request.url).searchParams.get("poster") === "1";

  const post = await prisma.post.findUnique({
    where: { storageKey: key },
    select: MEDIA_SELECT,
  });

  if (!post || post.isHidden) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  // An expired story's URL stops working. Not a 410 — the bytes and the key are
  // still there, and promoting it to a highlight brings this back to life — so
  // this response must not be cached either.
  if (post.isStory && !isStoryLive(post)) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const row = post as MediaRow & { mimeType: string | null };
  const cacheKey = wantPoster ? row.posterKey : row.storageKey;
  if (!cacheKey) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    // Guarantees the plaintext is on local disk, fetching and decrypting from
    // the archive if it is not. We then stream off disk rather than holding a
    // whole video in memory.
    await readMedia(row, wantPoster ? "poster" : "main");
  } catch (err) {
    if (err instanceof ShreddedError) {
      // 410, not 404: the resource existed and is permanently gone.
      return new NextResponse("Deleted", {
        status: 410,
        headers: { "cache-control": "no-store" },
      });
    }
    if (err instanceof NotYetAvailableError) {
      return new NextResponse(err.message, {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "30" },
      });
    }
    throw err;
  }

  const size = await cacheSize(cacheKey);
  if (size === null) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const contentType = wantPoster
    ? "image/jpeg"
    : (row as { mimeType: string | null }).mimeType ?? "application/octet-stream";

  // Storage keys are random and never reused, so a URL's bytes never change.
  // The exception is a story still on its clock: `immutable` would let a browser
  // keep serving it long after it expired, so those get a short window instead.
  const ephemeral = post.isStory && post.highlightId === null;
  const headers = new Headers({
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": ephemeral
      ? "public, max-age=300"
      : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });

  const range = parseRange(request.headers.get("range"), size);

  if (request.method === "HEAD") {
    headers.set("content-length", String(size));
    return new NextResponse(null, { status: 200, headers });
  }

  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    const stream = Readable.toWeb(
      cacheStream(cacheKey, range.start, range.end),
    ) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { status: 206, headers });
  }

  // A malformed Range must be answered with 416, not silently ignored.
  const rawRange = request.headers.get("range");
  if (rawRange && !range) {
    headers.set("content-range", `bytes */${size}`);
    return new NextResponse(null, { status: 416, headers });
  }

  headers.set("content-length", String(size));
  const stream = Readable.toWeb(
    cacheStream(cacheKey),
  ) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { status: 200, headers });
}

export { GET as HEAD };
