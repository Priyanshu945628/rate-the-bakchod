import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { authorizeWrite, handleRouteError, jsonError, readMultipart } from "@/lib/api";
import { limits } from "@/lib/config";
import { ensureOfficialUser } from "@/lib/house-accounts";
import { createPost, fetchFeed, parseFeedTab, toClientPost } from "@/lib/posts";
import { fetchPrivacy, visibilityAllows } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Feed page. Cursor-paginated for infinite scroll. `author` scopes it to one handle. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const viewer = await getCurrentUser();
    const authorHandle = url.searchParams.get("author");

    // A `SIGNED_IN` profile is enforced here too, not only on the page: otherwise
    // the feed API would be a way to walk straight around it.
    if (authorHandle) {
      const privacy = await fetchPrivacy(authorHandle);
      if (privacy && !visibilityAllows(privacy.visibility, viewer?.id ?? null)) {
        return jsonError("Sign in to see this profile.", 403);
      }
    }

    const page = await fetchFeed({
      // Same viewer-dependent default as the home page, so an explicit tab is
      // never required and a signed-in client that omits it still gets For You.
      tab: parseFeedTab(url.searchParams.get("tab"), viewer ? "foryou" : "fresh"),
      cursor: url.searchParams.get("cursor"),
      authorHandle,
      viewerId: viewer?.id ?? null,
      // Derived here, never read from the request: page two of your own profile has
      // to carry the same tombstones page one did, and a client asking for somebody
      // else's would be asking which of their posts a moderator took down.
      withTombstones: Boolean(authorHandle) && viewer?.handle === authorHandle,
    });

    return NextResponse.json(
      { posts: page.posts.map(toClientPost), nextCursor: page.nextCursor },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/** New post. Multipart: `file` and/or `tweetText`, plus optional `caption`. */
export async function POST(request: Request) {
  const auth = await authorizeWrite("upload");
  if ("response" in auth) return auth.response;

  try {
    const form = await readMultipart(request);
    const caption = form.get("caption");
    const tweetText = form.get("tweetText");
    const file = form.get("file");

    let buffer: Buffer | null = null;
    if (file instanceof File && file.size > 0) {
      // Check the declared size before buffering, so an oversized upload does
      // not have to be read into memory first to be rejected.
      if (file.size > limits.maxUploadBytes) {
        return jsonError(
          `File is too big (max ${limits.maxUploadBytes / 1048576} MB).`,
          413,
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
    }

    // Silently ignored for everyone else rather than refused: this field is not in
    // the ordinary composer, so a request carrying it is one somebody built by hand,
    // and the answer to that is a normal post, not a hint about what the flag does.
    const official = form.get("official") === "1" && auth.user.isAdmin;

    const post = await createPost({
      // An update is the platform talking, so the platform's account signs it. The
      // admin who wrote it is not named anywhere on the card — an announcement is
      // not a personal post, and next month a different admin writes the next one.
      author: official ? await ensureOfficialUser() : auth.user,
      caption: typeof caption === "string" ? caption : null,
      tweetText: typeof tweetText === "string" ? tweetText : null,
      file: buffer,
      official,
    });

    return NextResponse.json({ id: post.id }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
