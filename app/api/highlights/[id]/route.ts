import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/api";
import { visibilityAllows } from "@/lib/profile";
import { fetchHighlightOwner, fetchHighlightStories } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open one highlight.
 *
 * Separate from `GET /api/highlights`, which is the owner's editing view. This one
 * is what a visitor hits when they tap a highlight on someone's profile, so it is
 * readable by anyone the owner's `storiesVisibility` allows — and by nobody else,
 * checked here rather than left to the page that renders the row.
 *
 * Fetched on demand instead of server-rendered with the profile: a person can have
 * a dozen highlights of a hundred stories each, and loading all of that to draw six
 * circles would be absurd.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const highlight = await fetchHighlightOwner(id);
    if (!highlight) return jsonError("No such highlight.", 404);

    const viewer = await getCurrentUser();
    if (!visibilityAllows(highlight.storiesVisibility, viewer?.id ?? null)) {
      return jsonError("Sign in to see these.", 403);
    }

    const stories = await fetchHighlightStories(id, viewer?.id ?? null);
    return NextResponse.json(
      { highlight: { id: highlight.id, title: highlight.title }, author: highlight.author, stories },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
