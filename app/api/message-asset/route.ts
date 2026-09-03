import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { limits } from "@/lib/config";
import { putMessageImage } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a DM image. Multipart, one `file`.
 *
 * The row is created unattached and owned by the uploader; `POST` to the thread
 * claims it by key. Two steps so the compose box can preview the picture before the
 * message exists, and so a failed send does not lose the upload.
 *
 * These bytes never touch `enqueueArchiveUpload`. The archive is public, permanent
 * and has no delete, which is right for a rated post and completely wrong here.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("messageAsset");
  if ("response" in auth) return auth.response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Pick an image.", 400);
    }
    // Checked on the declared size, before the body is buffered.
    if (file.size > limits.dmImageUploadMaxBytes) {
      return jsonError(
        `Image is too big (max ${limits.dmImageUploadMaxBytes / 1048576} MB).`,
        413,
      );
    }

    const asset = await putMessageImage(auth.user, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ asset }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
