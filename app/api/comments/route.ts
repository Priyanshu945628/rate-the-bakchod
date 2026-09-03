import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { addComment, fetchPostWithComments, toClientComment } from "@/lib/posts";
import { commentsAllowedOnPost } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A post's comment thread. */
export async function GET(request: Request) {
  try {
    const postId = new URL(request.url).searchParams.get("postId");
    if (!postId) return jsonError("Which post?", 400);

    const viewer = await getCurrentUser();
    const post = await fetchPostWithComments(postId, viewer?.id ?? null);
    if (!post) return jsonError("That post is gone.", 404);

    // Sent with the thread rather than derived on the client: the switch lives on
    // the author's theme, which the feed's post shape deliberately does not carry.
    // Existing comments are still returned when it is off — nothing already said
    // gets hidden, only new ones are refused.
    const allowComments = await commentsAllowedOnPost(postId);

    return NextResponse.json(
      { comments: post.comments.map(toClientComment), allowComments },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeWrite("comment");
  if ("response" in auth) return auth.response;

  try {
    const body = (await readJsonBody(request)) as { postId?: unknown; body?: unknown };

    const postId = typeof body.postId === "string" ? body.postId : null;
    if (!postId) return jsonError("Which post?", 400);
    if (typeof body.body !== "string") return jsonError("Say something.", 400);

    // The author's own switch. Enforced here, not only by hiding the composer —
    // `CommentThread` renders "Comments are off." off the same setting.
    if (!(await commentsAllowedOnPost(postId))) {
      return jsonError("Comments are off on this post.", 403);
    }

    const comment = await addComment(auth.user, postId, body.body);
    return NextResponse.json({ comment: toClientComment(comment) }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
