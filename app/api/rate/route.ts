import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { submitRating } from "@/lib/posts";
import { parseRatingValue } from "@/lib/scoring";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeWrite("rate");
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json()) as { postId?: unknown; value?: unknown };

    const postId = typeof body.postId === "string" ? body.postId : null;
    if (!postId) return jsonError("Which post?", 400);

    const value = parseRatingValue(body.value);
    if (value === null) return jsonError("Rating must be a whole number from 1 to 10.", 400);

    const result = await submitRating(auth.user, postId, value);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
