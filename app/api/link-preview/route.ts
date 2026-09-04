import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { linkPreview } from "@/lib/link-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a link in a message turns out to be.
 *
 * A GET behind `authorizeWrite`, which reads oddly and is deliberate: the verb is a
 * read, but the *effect* is our server making a request to an address somebody else
 * chose. That is the thing worth metering and worth requiring an account for, and
 * `authorizeWrite` is where both of those live. See `lib/link-preview.ts` for what
 * the fetch is and is not allowed to reach.
 *
 * A URL with nothing to show answers `{ preview: null }` with a 200 rather than a 404:
 * the caller's question is "is there a card here", and "no" is a successful answer to
 * it. The short `max-age` is for the reader's own browser, so scrolling a thread back
 * and forth does not re-ask — the server keeps its own longer-lived cache.
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeWrite("linkPreview");
    if ("response" in auth) return auth.response;

    const url = new URL(request.url).searchParams.get("url");
    if (!url) return jsonError("`url` is required.", 400);

    const preview = await linkPreview(url);

    return NextResponse.json(
      { preview },
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
