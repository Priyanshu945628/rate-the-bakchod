import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api";
import { searchPeople } from "@/lib/follows";
import { searchPosts, toClientPost } from "@/lib/posts";
import { isSearchable, normalizeQuery, parseSearchTab } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One more page of search results, for the scroll under the server-rendered first one.
 *
 * The array is named after the tab — `posts` or `people` — which is what lets one hook
 * in the client read both without knowing which it asked for.
 *
 * A query too short to run comes back as an empty page rather than a 400. The box types
 * straight into the URL, so `b` is a state every search passes through on the way to
 * `bakchod`, not a mistake worth reporting to whoever is still typing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = normalizeQuery(url.searchParams.get("q"));
    const type = parseSearchTab(url.searchParams.get("type"));
    const cursor = url.searchParams.get("cursor");
    const viewer = await getCurrentUser();

    const headers = { "cache-control": "no-store" };

    if (!isSearchable(query)) {
      return NextResponse.json({ [type]: [], nextCursor: null }, { headers });
    }

    if (type === "people") {
      const page = await searchPeople(query, viewer?.id ?? null, cursor);
      return NextResponse.json(page, { headers });
    }

    const page = await searchPosts({ query, cursor, viewerId: viewer?.id ?? null });
    return NextResponse.json(
      { posts: page.posts.map(toClientPost), nextCursor: page.nextCursor },
      { headers },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
