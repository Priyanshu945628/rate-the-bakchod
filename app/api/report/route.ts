import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { reportPost } from "@/lib/posts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeWrite("report");
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json()) as { postId?: unknown; reason?: unknown };

    const postId = typeof body.postId === "string" ? body.postId : null;
    if (!postId) return jsonError("Which post?", 400);

    const reason = typeof body.reason === "string" ? body.reason : "";
    await reportPost(auth.user, postId, reason);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
