import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, readJsonBody } from "@/lib/api";
import { markPostsSeen } from "@/lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "These posts have been on my screen." `{ postIds: string[] }`.
 *
 * The one write in the app that nobody asked to make — the feed reports it as it
 * scrolls — so it is built to be ignorable in both directions. A body that makes no
 * sense counts as nothing seen rather than a 400, and the response says only how many
 * rows were new, which is a number the client has no use for and reads purely as
 * "received".
 *
 * Signed-in only, which is not a restriction so much as a definition: what it records
 * is one person's history, and a signed-out reader does not have one.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("seen");
  if ("response" in auth) return auth.response;

  try {
    const body = ((await readJsonBody(request)) ?? {}) as { postIds?: unknown };
    const ids = Array.isArray(body.postIds) ? body.postIds : [];

    const seen = await markPostsSeen(auth.user.id, ids);
    return NextResponse.json({ seen }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
