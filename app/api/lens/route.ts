import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { limits } from "@/lib/config";
import { isFaceLens } from "@/lib/lenses/catalog";
import { renderLens } from "@/lib/lenses/render";
import { isHeic, sniffKind } from "@/lib/media/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Draw a face lens onto a photo. Multipart: `file`, `lens`.
 *
 * Answers with the rendered image itself rather than JSON, and stores nothing. What comes
 * back goes to the browser, which shows it, lets it be swapped for another lens, and only
 * then sends the one that was chosen on to `/api/posts` or `/api/stories` — the two
 * endpoints that stay the only things creating rows. So a person who tries six lenses and
 * sends none of them leaves nothing behind to encrypt, archive, expire or clean up.
 *
 * The colour presets are not here: those are a CSS filter the browser can apply live, and
 * a round trip to tint a picture orange would be a slow way to do something instant.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("lens");
  if ("response" in auth) return auth.response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const lens = form.get("lens");

    if (!(file instanceof File) || file.size === 0) return jsonError("No photo.", 400);
    if (file.size > limits.maxUploadBytes) {
      return jsonError(`File is too big (max ${limits.maxUploadBytes / 1048576} MB).`, 413);
    }
    // Only face lenses reach the server, and only ones the catalog names — the render
    // reads its art from a fixed recipe, so an unknown id has nothing to draw anyway.
    if (typeof lens !== "string" || !isFaceLens(lens)) return jsonError("Unknown lens.", 400);

    const input = Buffer.from(await file.arrayBuffer());
    // Magic bytes, not the declared type: the same rule the upload path follows. HEIC is
    // called out separately because sharp's libvips has no HEVC decoder and would
    // otherwise fail deep in the encoder with a libvips string for a message.
    if (sniffKind(input) !== "IMAGE") return jsonError("Lenses work on photos.", 415);
    if (isHeic(input)) return jsonError("HEIC photos are not supported yet.", 415);

    const rendered = await renderLens(input, lens);
    return new NextResponse(new Uint8Array(rendered.data), {
      status: 200,
      headers: {
        "content-type": rendered.mimeType,
        "content-length": String(rendered.data.length),
        "cache-control": "no-store",
        // So the camera can say the lens landed on a guess rather than on a found face,
        // without a second request or a JSON envelope around the bytes.
        "x-face-found": rendered.faceFound ? "1" : "0",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
