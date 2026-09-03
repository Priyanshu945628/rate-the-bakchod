import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/api";
import { fetchFollowList, fetchSuggestions } from "@/lib/follows";
import { fetchPrivacy, visibilityAllows } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * People, in three flavours, chosen by `mode`:
 *
 *   - `followers` / `following` — one page of a person's graph, needs `handle`.
 *   - `suggestions` — who the viewer might follow. No handle; it is about them.
 *
 * One route rather than three because the response shape and the client that reads
 * it are identical, and the only thing that differs is which query fills it.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "suggestions";
    const viewer = await getCurrentUser();

    if (mode === "suggestions") {
      const people = await fetchSuggestions(viewer?.id ?? null);
      return NextResponse.json(
        { people, nextCursor: null },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (mode !== "followers" && mode !== "following") {
      return jsonError("`mode` must be followers, following or suggestions.", 400);
    }

    const handle = url.searchParams.get("handle");
    if (!handle) return jsonError("Which person?", 400);

    // Same gate the profile page uses. A private profile's follower list is part
    // of the profile, so leaving this off would make the API the way around it.
    const privacy = await fetchPrivacy(handle);
    if (privacy && !visibilityAllows(privacy.visibility, viewer?.id ?? null)) {
      return jsonError("Sign in to see this profile.", 403);
    }

    const page = await fetchFollowList(
      handle,
      mode,
      viewer?.id ?? null,
      url.searchParams.get("cursor"),
    );

    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
