import { NextResponse } from "next/server";
import sharp from "sharp";
import { authorizeWrite, handleRouteError, jsonError, readMultipart } from "@/lib/api";
import { TRACK_EDGE, detectFaces } from "@/lib/lenses/detect";
import { largestFace } from "@/lib/lenses/geometry";
import { isHeic, sniffKind } from "@/lib/media/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A frame's worth of no more than this. A 384px JPEG is ~20KB; anything approaching the
 * cap is not a viewfinder frame, and this route is called often enough to say so cheaply.
 */
const MAX_BYTES = 1024 * 1024;

/**
 * Where the face is in one viewfinder frame. Multipart: `file`.
 *
 * The half of a lens that has to come from the server, called on a loop while the camera
 * is open. OpenCV is the only thing here — no art, no compositing, no tone — because the
 * browser can draw the layers itself once it knows where they go, and shipping a 10MB WASM
 * classifier to a phone to avoid one small request would be the worse trade.
 *
 * Coordinates come back in the pixels of the copy that was looked at, along with its size,
 * so the caller scales by `videoWidth / width` rather than trusting an agreement about
 * resolution. `face` is null when nothing was found; the caller has a guess for that, and a
 * lens that lands on a guess is better than a viewfinder that goes blank.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("lensTrack");
  if ("response" in auth) return auth.response;

  try {
    const form = await readMultipart(request);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return jsonError("No frame.", 400);
    if (file.size > MAX_BYTES) return jsonError("Frame is too big.", 413);

    const input = Buffer.from(await file.arrayBuffer());
    if (sniffKind(input) !== "IMAGE") return jsonError("Frames must be photos.", 415);
    if (isHeic(input)) return jsonError("HEIC frames are not supported.", 415);

    // Straight to what the classifier reads: greyscale, small, raw. No rotate, because
    // this comes off a canvas rather than a camera roll and carries no EXIF.
    const { data, info } = await sharp(input, { failOn: "none" })
      .resize({ width: TRACK_EDGE, height: TRACK_EDGE, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const face = largestFace(await detectFaces(data, info.width, info.height));
    return NextResponse.json(
      { width: info.width, height: info.height, face },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
