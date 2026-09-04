/**
 * Photo filters, and the drawing that bakes one in.
 *
 * A filter is one CSS filter string and nothing else. That same string styles the
 * preview and sets `ctx.filter` when the bytes are drawn, so what gets sent is what
 * was on screen — a preview assembled any other way is a preview that can lie.
 *
 * Baked into the pixels rather than stored beside the picture. Nobody else's browser
 * has to agree about what "Noir" means, and a client that has never heard of a filter
 * cannot render it as no filter at all.
 *
 * Three surfaces share the list: a photo on its way into a DM, and the camera's still
 * and its clip. One list is the point — Retro has to be the same Retro wherever it is
 * offered, and a look somebody found in a chat has to be there when they open the
 * camera.
 */

export interface PhotoFilter {
  id: string;
  label: string;
  /** Empty means untouched — the picture exactly as it was taken or picked. */
  css: string;
}

/** The one every picture starts on. */
export const ORIGINAL = "original";

/**
 * Eight, in the order they are shown.
 *
 * Enough to change the mood of a photo, few enough that the strip fits under the
 * preview on a phone without becoming a thing to be browsed.
 */
export const PHOTO_FILTERS: PhotoFilter[] = [
  { id: ORIGINAL, label: "Original", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.12)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.5) brightness(0.88)" },
  { id: "warm", label: "Warm", css: "sepia(0.3) saturate(1.4) contrast(1.05)" },
  {
    id: "cool",
    label: "Cool",
    css: "hue-rotate(-12deg) saturate(1.15) brightness(1.05) contrast(1.05)",
  },
  { id: "vivid", label: "Vivid", css: "saturate(1.65) contrast(1.18)" },
  { id: "fade", label: "Fade", css: "saturate(0.7) brightness(1.12) contrast(0.86)" },
  { id: "retro", label: "Retro", css: "sepia(0.45) saturate(1.55) hue-rotate(-18deg) contrast(1.12)" },
];

/** Look one up by id, falling back to leaving the picture alone. */
export function filterCss(id: string): string {
  return PHOTO_FILTERS.find((preset) => preset.id === id)?.css ?? "";
}

/**
 * Whether this browser can draw a filter into a canvas.
 *
 * `ctx.filter` is the one part of this that is not universal — Safari only shipped it
 * in 17. Where it is missing the strip is not drawn at all, on the same principle as
 * the composer having no microphone: a filter that shows in the preview and not in the
 * photo that arrives is worse than no filters.
 *
 * Needs a document, so call it from an event handler rather than at module scope or
 * from an effect — the click that opens a composer or a camera is the moment this is
 * unambiguously being asked on the client.
 */
export function supportsFilters(): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return false;
  ctx.filter = "grayscale(1)";
  return ctx.filter !== "none" && ctx.filter !== "";
}

interface RenderCaps {
  /** Longest edge of the result, matching whichever server limit applies. */
  maxEdge: number;
  /** What the upload route will accept, which decides the format ladder below. */
  uploadMaxBytes: number;
}

/**
 * Draw a picked file through a filter and hand back a file to upload.
 *
 * `imageOrientation: "from-image"` is not optional. Canvas output carries no EXIF, so
 * sharp's `.rotate()` has nothing left to read downstream; if the rotation were not
 * applied here a photo taken sideways would stay sideways for good.
 */
export async function renderPhoto(
  file: File,
  css: string,
  caps: RenderCaps,
): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(
    () => {
      // A browser that will not decode a picked image is nearly always looking at a
      // HEIC straight off a phone. The DOMException for it names an internal decoder,
      // which is no use at all under a compose box.
      throw new Error("Could not read that image. Try a JPEG or PNG.");
    },
  );
  try {
    return await bake(bitmap, bitmap.width, bitmap.height, css, caps);
  } finally {
    bitmap.close();
  }
}

/**
 * A frame the camera already drew, through a filter, as a file to upload.
 *
 * The canvas handed over here is deliberately unfiltered, so the strip under a still
 * stays live after the shutter: whichever filter is chosen at the moment Send is
 * pressed is the one that gets drawn, not the one that happened to be up when the
 * picture was taken.
 */
export function renderFrame(
  frame: HTMLCanvasElement,
  css: string,
  caps: RenderCaps,
): Promise<File> {
  return bake(frame, frame.width, frame.height, css, caps);
}

/**
 * A frame's size, capped to a longest edge.
 *
 * Never upscales: a picture or a camera smaller than the cap keeps the size it came in
 * at, and nothing ever rounds away to nothing.
 *
 * `even` is for a recording rather than a still. H.264 encodes in 2×2 blocks, and an odd
 * edge is the kind of clip some players letterbox by a pixel and others refuse outright.
 */
export function fit(
  width: number,
  height: number,
  maxEdge: number,
  even = false,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const step = even ? 2 : 1;
  const to = (edge: number) => Math.max(step, Math.round((edge * scale) / step) * step);
  return { width: to(width), height: to(height) };
}

/**
 * The one draw both paths share.
 *
 * The resize rides along in the same draw. The server resizes again with sharp and
 * remains the authority on what gets stored; doing it here first is what stops a 20MB
 * phone photo from being uploaded at 20MB only to be thrown away — so this path is
 * quicker than the raw upload it replaces even with no filter chosen.
 */
async function bake(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  css: string,
  caps: RenderCaps,
): Promise<File> {
  const { width, height } = fit(sourceWidth, sourceHeight, caps.maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  if (css) ctx.filter = css;
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await encode(canvas, caps.uploadMaxBytes);
  return new File([blob], `photo.${extensionFor(blob.type)}`, { type: blob.type });
}

/**
 * Canvas out to bytes.
 *
 * WebP first: it keeps transparency, and the server stores WebP anyway, so this is the
 * one format that does not add a second lossy generation on the way there. A browser
 * that cannot encode it falls back to PNG on its own, which also keeps transparency —
 * and only if *that* comes out too big to upload does JPEG get used, where a
 * transparent background turning black still beats a photo that will not send.
 */
async function encode(canvas: HTMLCanvasElement, uploadMaxBytes: number): Promise<Blob> {
  const first = await toBlob(canvas, "image/webp", 0.92);
  if (first.type === "image/webp" || first.size <= uploadMaxBytes) return first;
  return toBlob(canvas, "image/jpeg", 0.9);
}

/** `canvas.toBlob` as a promise. A null blob means the encode failed. */
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image."))),
      type,
      quality,
    );
  });
}

/**
 * Extension for the uploaded filename.
 *
 * Cosmetic — the route sniffs magic bytes and never looks at the name — but a file
 * called `photo` with no extension is the kind of small wrongness that gets copied.
 */
function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "webp";
}
