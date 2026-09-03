import "server-only";

/**
 * Banner / logo / highlight-cover normalisation.
 *
 * Separate from `normalizeUpload` because the constraints are different — no
 * video, no audio, no perceptual hash, a much smaller size ceiling — but it
 * reuses the same two things that matter: `sniffKind`, so a `.png` that is
 * really an MP4 is refused, and the same `sharp().rotate().resize().webp()`
 * chain, which is what actually strips EXIF. A banner is often a phone photo, so
 * it gets exactly the same GPS-removal treatment a post does.
 */

import sharp from "sharp";
import { limits } from "../config";
import { MediaError, sniffKind } from "./pipeline";

export interface NormalizedProfileImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Quality ladder. Most images clear the size cap on the first pass; a noisy
 * photo may not, and re-encoding it smaller is friendlier than telling the user
 * to go and compress it themselves.
 */
const QUALITY_STEPS = [82, 68, 52];

export async function normalizeProfileImage(
  input: Buffer,
  maxEdge: number,
): Promise<NormalizedProfileImage> {
  if (input.byteLength === 0) throw new MediaError("That file is empty.");
  if (input.byteLength > limits.profileAssetUploadMaxBytes) {
    throw new MediaError(
      `Image is ${(input.byteLength / 1048576).toFixed(1)} MB — the limit is ` +
        `${limits.profileAssetUploadMaxBytes / 1048576} MB.`,
    );
  }

  // Magic bytes, never the declared Content-Type.
  if (sniffKind(input) !== "IMAGE") {
    throw new MediaError("That needs to be an image — PNG, JPEG, WebP, GIF or AVIF.");
  }

  let last: { data: Buffer; width: number; height: number } | null = null;

  for (const quality of QUALITY_STEPS) {
    // An animated source is flattened to its first frame. Decoration should not
    // be able to strobe at a visitor, and a still logo is the common case.
    const { data, info } = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true })
      .catch((err: unknown) => {
        throw new MediaError(
          `Could not read that image: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      });

    last = { data, width: info.width, height: info.height };
    if (data.byteLength <= limits.profileAssetMaxBytes) break;
  }

  if (!last) throw new MediaError("Could not process that image.");

  if (last.data.byteLength > limits.profileAssetMaxBytes) {
    throw new MediaError(
      `That image is still ${Math.round(last.data.byteLength / 1024)} KB after ` +
        `compression — the limit is ${Math.round(limits.profileAssetMaxBytes / 1024)} KB. ` +
        `Try something simpler or smaller.`,
    );
  }

  return {
    data: last.data,
    mimeType: "image/webp",
    width: last.width,
    height: last.height,
    bytes: last.data.byteLength,
  };
}

/** Longest-edge ceiling for each slot. */
export function maxEdgeForSlot(slot: "BANNER" | "LOGO" | "HIGHLIGHT_COVER"): number {
  if (slot === "BANNER") return limits.bannerMaxEdge;
  if (slot === "LOGO") return limits.logoMaxEdge;
  return limits.highlightCoverMaxEdge;
}
