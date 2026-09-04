import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { authorizeWrite, handleRouteError, jsonError, readMultipart } from "@/lib/api";
import { limits } from "@/lib/config";
import { createStory, fetchPostedStory, fetchStoryTrays } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every live tray, for the strip above the feed. */
export async function GET() {
  try {
    const viewer = await getCurrentUser();
    const trays = await fetchStoryTrays(viewer?.id ?? null);
    return NextResponse.json({ trays }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Post a story. Multipart: `file`, optional `caption`.
 *
 * A story is a `Post` row with an expiry, so this goes through the ordinary upload
 * path — normalised, EXIF-stripped, encrypted, archived, crypto-shreddable. Text-only
 * is refused: a story with nothing to look at is just a post that vanishes.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("story");
  if ("response" in auth) return auth.response;

  try {
    const form = await readMultipart(request);
    const file = form.get("file");
    const caption = form.get("caption");

    if (!(file instanceof File) || file.size === 0) {
      return jsonError("A story needs an image, video or clip.", 400);
    }
    if (file.size > limits.maxUploadBytes) {
      return jsonError(`File is too big (max ${limits.maxUploadBytes / 1048576} MB).`, 413);
    }

    const story = await createStory(
      auth.user,
      Buffer.from(await file.arrayBuffer()),
      typeof caption === "string" ? caption : null,
    );

    // The row comes back with it, so the tray can add the ring on the spot rather
    // than reloading the page to discover its own story exists.
    const posted = await fetchPostedStory(story.id, auth.user.id);
    return NextResponse.json({ id: story.id, ...posted }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
