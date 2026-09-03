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
import { MediaError, isHeic, sniffKind } from "./pipeline";

export interface NormalizedProfileImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * The two size ceilings, so a caller that is not a banner can bring its own.
 *
 * DM images run the same chain under their own numbers — identical today, but
 * `limits.dmImageMaxBytes` existing and not being the thing enforced is exactly how
 * a limit quietly stops meaning anything.
 */
export interface ImageCaps {
  /** Ceiling at the door, before any of it is handed to sharp. */
  uploadMaxBytes: number;
  /** Ceiling after the quality ladder has done what it can. */
  maxBytes: number;
}

const PROFILE_CAPS: ImageCaps = {
  uploadMaxBytes: limits.profileAssetUploadMaxBytes,
  maxBytes: limits.profileAssetMaxBytes,
};

/**
 * Quality ladder. Most images clear the size cap on the first pass; a noisy
 * photo may not, and re-encoding it smaller is friendlier than telling the user
 * to go and compress it themselves.
 */
const QUALITY_STEPS = [82, 68, 52];

export async function normalizeProfileImage(
  input: Buffer,
  maxEdge: number,
  caps: ImageCaps = PROFILE_CAPS,
): Promise<NormalizedProfileImage> {
  if (input.byteLength === 0) throw new MediaError("That file is empty.");
  if (input.byteLength > caps.uploadMaxBytes) {
    throw new MediaError(
      `Image is ${(input.byteLength / 1048576).toFixed(1)} MB — the limit is ` +
        `${caps.uploadMaxBytes / 1048576} MB.`,
    );
  }

  // Magic bytes, never the declared Content-Type.
  if (sniffKind(input) !== "IMAGE") {
    throw new MediaError("That needs to be an image — PNG, JPEG, WebP, GIF or AVIF.");
  }
  // A real image that this build cannot decode. Refused here, by name, rather than
  // left to fail inside the encoder where the only message available is libvips'.
  if (isHeic(input)) {
    throw new MediaError("HEIC photos are not supported — send it as JPEG or PNG.");
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
        // libvips messages name internal loaders and buffer offsets. They belong in
        // the log, not in a phone-sized error under a compose box.
        console.error("[media] sharp could not decode an image:", err);
        throw new MediaError("Could not read that image. Try a JPEG or PNG.");
      });

    last = { data, width: info.width, height: info.height };
    if (data.byteLength <= caps.maxBytes) break;
  }

  if (!last) throw new MediaError("Could not process that image.");

  if (last.data.byteLength > caps.maxBytes) {
    throw new MediaError(
      `That image is still ${Math.round(last.data.byteLength / 1024)} KB after ` +
        `compression — the limit is ${Math.round(caps.maxBytes / 1024)} KB. ` +
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
