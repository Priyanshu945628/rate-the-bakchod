import { NextResponse } from "next/server";
import { toBytes } from "@/lib/media/store";
import { readProfileAsset } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keys are 16 random bytes as hex. Validated before the query, not after. */
const KEY_RE = /^[0-9a-f]{32}$/;

function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Banner, logo and highlight-cover bytes.
 *
 * These are small normalised webps living in Postgres rather than in the encrypted
 * archive: decoration does not belong in a permanent, undeletable public library.
 * They are public by design — a banner is the first thing a visitor sees — so there
 * is no auth check here, and none is wanted: adding one would cost a session
 * round trip on every profile view.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!KEY_RE.test(key)) return notFound();

  const asset = await readProfileAsset(key);
  if (!asset) return notFound();

  const body = toBytes(Buffer.from(asset.data));

  // The key is minted per upload and never reused, so these bytes never change.
  // Replacing an image yields a new URL, which is what makes `immutable` honest.
  const headers = new Headers({
    "content-type": asset.mimeType,
    "content-length": String(body.byteLength),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });

  if (request.method === "HEAD") {
    return new NextResponse(null, { status: 200, headers });
  }

  return new NextResponse(body, { status: 200, headers });
}

export { GET as HEAD };
