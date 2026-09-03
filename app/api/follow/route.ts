import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { setFollow } from "@/lib/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follow or unfollow someone.
 *
 * `{ handle, following }` rather than separate endpoints, because the button is a
 * toggle and the client already knows which way it is going. Sending the desired
 * end state also makes a double-tap harmless: the second request asks for the
 * state the graph is already in and gets it.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("follow");
  if ("response" in auth) return auth.response;

  try {
    const body = await readJsonBody(request);
    const { handle, following } = (body ?? {}) as Record<string, unknown>;

    if (typeof handle !== "string" || handle.length === 0) {
      return jsonError("Which person?", 400);
    }
    if (typeof following !== "boolean") {
      return jsonError("`following` must be true or false.", 400);
    }

    const state = await setFollow(auth.user, handle, following);

    return NextResponse.json(
      {
        followersCount: state.followersCount,
        followingCount: state.followingCount,
        isFollowing: state.isFollowing,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
