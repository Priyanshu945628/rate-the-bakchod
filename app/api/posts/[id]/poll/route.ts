import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { submitPollVote } from "@/lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Answer a poll. `{ optionId }`.
 *
 * Its own bucket rather than `rate`, because these are two different acts on two
 * different kinds of post and spending one budget on the other would mean a reader
 * who answers a few polls can no longer score anything.
 *
 * No ownership check and no "is this a poll" check up here: `submitPollVote` looks the
 * option up by id *and* post, so an option that is not on this poll — or a poll that
 * is hidden, deleted, or not a poll at all — comes back as the same 404.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeWrite("pollVote");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    const body = ((await readJsonBody(request)) ?? {}) as { optionId?: unknown };

    const optionId = typeof body.optionId === "string" ? body.optionId : null;
    if (!optionId) return jsonError("Which option?", 400);

    const result = await submitPollVote(auth.user, id, optionId);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
