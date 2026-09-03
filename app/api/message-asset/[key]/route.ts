import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readMessageAttachment } from "@/lib/messages";
import { toBytes } from "@/lib/media/store";

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
 * DM image bytes, for a member of the thread it was sent in.
 *
 * Everything about this route is the opposite of `/api/profile-asset/[key]`, and
 * deliberately so. That one is public and `immutable` because a banner is meant to be
 * seen by strangers; this one authenticates every request and answers
 * `private, no-store`, because a shared cache holding a private picture is the same
 * leak as no auth at all — just delayed.
 *
 * Not-a-member, no-such-key and not-signed-in are all the same 404. A 403 on this
 * route would confirm that a key is real to anyone who scraped one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!KEY_RE.test(key)) return notFound();

  const user = await getCurrentUser();
  if (!user) return notFound();

  const asset = await readMessageAttachment(key, user.id);
  if (!asset) return notFound();

  const body = toBytes(Buffer.from(asset.data));
  const headers = new Headers({
    "content-type": asset.mimeType,
    "content-length": String(body.byteLength),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });

  if (request.method === "HEAD") {
    return new NextResponse(null, { status: 200, headers });
  }

  return new NextResponse(body, { status: 200, headers });
}

export { GET as HEAD };
