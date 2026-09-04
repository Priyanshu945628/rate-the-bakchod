import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { deleteOwnPost, editPost, type PostEdit } from "@/lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An author acting on their own post. Both verbs put `authorId` in the `where`
 * downstream, so neither needs — or gets — an ownership check up here.
 *
 * Both spend the `profile` bucket. There is no `post` bucket, and `upload` is five
 * an hour: right for encrypting and archiving a video, wrong for fixing a typo.
 */

/**
 * Rewrite the words. `{ caption?, tweetText? }`, where a key that is absent is left
 * alone and `null` or `""` clears it — so the editor can save either field on its
 * own, and "clear the caption" stays tellable from "only change the tweet text".
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeWrite("profile");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    const body = ((await readJsonBody(request)) ?? {}) as {
      caption?: unknown;
      tweetText?: unknown;
    };

    const edit: PostEdit = {};
    if ("caption" in body) {
      if (body.caption !== null && typeof body.caption !== "string") {
        return jsonError("`caption` must be a string or null.", 400);
      }
      edit.caption = body.caption;
    }
    if ("tweetText" in body) {
      if (body.tweetText !== null && typeof body.tweetText !== "string") {
        return jsonError("`tweetText` must be a string or null.", 400);
      }
      edit.tweetText = body.tweetText;
    }

    const updated = await editPost(auth.user, id, edit);
    return NextResponse.json(updated, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Delete it. The same crypto-shred a story gets: the archived ciphertext outlives
 * this request, and the key it needs does not.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeWrite("profile");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    await deleteOwnPost(auth.user, id);
    return NextResponse.json({ ok: true, shredded: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
