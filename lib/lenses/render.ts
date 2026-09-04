/**
 * Drawing a face lens.
 *
 * One pass: decode, shrink, find the face in a small greyscale copy, then tone and
 * composite at full size. sharp does the pixels, OpenCV only says where the face is, and
 * the recipe says what to draw — so the interesting decisions all live in data.
 *
 * Everything is measured from the face rather than the frame, which is what lets one
 * recipe work on a close-up selfie and on somebody standing across a room.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions, type Sharp } from "sharp";
import { limits } from "../config";
import { MediaError } from "../media/pipeline";
import { DETECT_EDGE, detectFaces } from "./detect";
import {
  anchorPoint,
  assumedFace,
  faceFrame,
  largestFace,
  scaleDetection,
  shift,
  type FaceFrame,
} from "./geometry";
import { RECIPES, type LensLayer, type LensTone } from "./recipes";

export interface RenderedLens {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** False when no face was found and the lens landed on an assumed one. */
  faceFound: boolean;
}

/** How far a corner sticker sits in, as a fraction of the shorter edge. */
const CORNER_INSET = 0.06;

/** Rotating art by less than this is a resample that changes nothing. */
const ROLL_DEADZONE = 2;

/** RGBA art, ready to place. */
interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Draw a lens onto an uploaded photo.
 *
 * The result is WebP, at the same ceiling an ordinary upload is held to, and goes back to
 * the browser rather than into storage — the client sends it on to `/api/posts` or
 * `/api/stories`, which stay the only things that create rows. That keeps this route free
 * of the whole posting path: no archive, no encryption, no expiry, nothing to clean up if
 * somebody renders eight lenses and sends none of them.
 */
export async function renderLens(input: Buffer, lensId: string): Promise<RenderedLens> {
  const recipe = RECIPES[lensId];
  if (!recipe) throw new MediaError("Unknown lens.");

  // `.rotate()` first, so EXIF orientation is applied while it is still readable. From
  // here on the pixels are raw RGB and every measurement is in the same coordinates the
  // detector will report.
  const { data: base, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: limits.maxImageEdge,
      height: limits.maxImageEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const raw = { raw: { width, height, channels: 3 as const } };

  const detected = await locateFace(base, raw, width, height);
  const frame = faceFrame(detected.face);

  let canvas = sharp(base, raw);
  if (recipe.tone?.brightness || recipe.tone?.saturation) {
    canvas = canvas.modulate({
      brightness: recipe.tone.brightness,
      saturation: recipe.tone.saturation,
    });
  }

  const layers: OverlayOptions[] = [];
  const soft = await softSkin(canvas, recipe.tone, frame, width, height);
  if (soft) layers.push(soft);

  for (const layer of recipe.layers) {
    const placed = await placeLayer(layer, frame, width, height);
    if (placed) layers.push(placed);
  }

  const data = await canvas
    .composite(layers)
    .webp({ quality: 88 })
    .toBuffer();

  return { data, mimeType: "image/webp", width, height, faceFound: detected.found };
}

/**
 * Where the face is, or where it probably is.
 *
 * Detection runs on a greyscale copy no bigger than 512px and the result is scaled back
 * up. The largest box wins: small extra detections are nearly always a false positive on
 * a patterned shirt or a second, blurrier face in the background, and a lens belongs on
 * the person who took the photo.
 */
async function locateFace(
  base: Buffer,
  raw: { raw: { width: number; height: number; channels: 3 } },
  width: number,
  height: number,
): Promise<{ face: ReturnType<typeof assumedFace>; found: boolean }> {
  const { data: grey, info } = await sharp(base, raw)
    .resize({ width: DETECT_EDGE, height: DETECT_EDGE, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const faces = await detectFaces(grey, info.width, info.height);
  const best = largestFace(faces);
  if (!best) return { face: assumedFace(width, height), found: false };
  return { face: scaleDetection(best, width / info.width), found: true };
}

/**
 * The soft-skin layer, or nothing if this lens does not ask for one.
 *
 * Blur the whole picture, then let it back through a feathered oval over the face. What
 * survives is a smoothing that fades out before it reaches the hair, the edge of the jaw
 * or the background, so the picture keeps its edges and the skin loses its texture —
 * which is the entire trick behind every "beauty" filter.
 */
async function softSkin(
  canvas: Sharp,
  tone: LensTone | undefined,
  frame: FaceFrame,
  width: number,
  height: number,
): Promise<OverlayOptions | null> {
  const smooth = tone?.smooth;
  if (!smooth) return null;

  // Scaled by the face, not the frame: the same sigma has to soften the same pores on a
  // 400px thumbnail and a 1600px still.
  const sigma = Math.min(60, Math.max(0.4, (smooth.sigma * frame.eyeSpan) / 100));
  const blurred = await canvas.clone().blur(sigma).ensureAlpha().png().toBuffer();
  const masked = await sharp(blurred)
    .composite([{ input: Buffer.from(ovalMask(frame, width, height, smooth.strength)), blend: "dest-in" }])
    .png()
    .toBuffer();
  return { input: masked, left: 0, top: 0 };
}

/** A feathered white oval over the face, at the strength the recipe asked for. */
function ovalMask(frame: FaceFrame, width: number, height: number, strength: number): string {
  const cx = Math.round(frame.box.x + frame.box.width / 2);
  const cy = Math.round(frame.box.y + frame.box.height * 0.56);
  const rx = Math.round(frame.box.width * 0.56);
  const ry = Math.round(frame.box.height * 0.68);
  const alpha = Math.min(1, Math.max(0, strength)).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><radialGradient id="m" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fff" stop-opacity="${alpha}"/>
    <stop offset="0.58" stop-color="#fff" stop-opacity="${alpha}"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient></defs>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#m)"/>
</svg>`;
}

/**
 * One layer, sized, turned, faded and cropped to the frame.
 *
 * Cropping rather than trusting the compositor is the important part: a horse head is
 * wider than the face it sits on and a beard reaches past the chin, so on a photo where
 * somebody stood near the edge the art genuinely does hang off the canvas. Working out
 * the overlap here means the layer is always a rectangle that fits.
 */
async function placeLayer(
  layer: LensLayer,
  frame: FaceFrame,
  width: number,
  height: number,
): Promise<OverlayOptions | null> {
  const art = await loadArt(layer.art);
  const size = targetSize(layer, art, frame, width, height);
  if (size.width < 2 || size.height < 2) return null;

  let raster = await rasterize(art, size.width, size.height);
  if (layer.opacity !== undefined && layer.opacity < 1) raster = fade(raster, layer.opacity);
  if (!layer.fixed && Math.abs(frame.roll) > ROLL_DEADZONE) {
    raster = await turn(raster, frame.roll);
  }

  const origin = layerOrigin(layer, frame, raster, width, height);
  const clipped = await clipToFrame(raster, origin, width, height);
  if (!clipped) return null;

  return {
    input: clipped.data,
    raw: { width: clipped.width, height: clipped.height, channels: 4 },
    left: clipped.left,
    top: clipped.top,
    blend: layer.blend ?? "over",
  };
}

/** Layer size in pixels: eye spans for facial art, a fraction of the frame otherwise. */
function targetSize(
  layer: LensLayer,
  art: Art,
  frame: FaceFrame,
  width: number,
  height: number,
): { width: number; height: number } {
  if (layer.anchor === "frame") {
    // A full-frame overlay is stretched to fit exactly. Bokeh and sparkle scatter have no
    // shape to distort, and letterboxing them would leave a visible edge.
    if (layer.width >= 1 && !layer.corner) return { width, height };
    const w = Math.round(layer.width * width);
    return { width: w, height: Math.round((w * art.height) / art.width) };
  }
  const w = Math.round(layer.width * frame.eyeSpan);
  return { width: w, height: Math.round((w * art.height) / art.width) };
}

/** Top-left corner the layer is composited at, which may be off-canvas. */
function layerOrigin(
  layer: LensLayer,
  frame: FaceFrame,
  raster: Raster,
  width: number,
  height: number,
): { left: number; top: number } {
  if (layer.anchor === "frame") {
    const inset = Math.round(Math.min(width, height) * CORNER_INSET);
    const right = width - raster.width - inset;
    const bottom = height - raster.height - inset;
    if (layer.corner === "tl") return { left: inset, top: inset };
    if (layer.corner === "tr") return { left: right, top: inset };
    if (layer.corner === "bl") return { left: inset, top: bottom };
    if (layer.corner === "br") return { left: right, top: bottom };
    return { left: 0, top: 0 };
  }
  const base = anchorPoint(frame, layer.anchor);
  const point = layer.dx || layer.dy ? shift(frame, base, layer.dx ?? 0, layer.dy ?? 0) : base;
  return {
    left: Math.round(point.x - raster.width / 2),
    top: Math.round(point.y - raster.height / 2),
  };
}

/**
 * SVG to RGBA pixels at exactly the size wanted.
 *
 * The density is what makes it sharp: librsvg rasterises at 72dpi by default, so a
 * drawing 240 units wide would be resampled up from 240px to fill a 600px moustache and
 * look like it. Rendering at the density that matches the target instead draws the vector
 * at full size in the first place.
 */
async function rasterize(art: Art, width: number, height: number): Promise<Raster> {
  const density = Math.min(2400, Math.max(72, Math.round((72 * width) / art.width)));
  const { data, info } = await sharp(art.data, { density })
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Uniform opacity, by scaling the alpha channel. sharp's compositor has no dial for it. */
function fade(raster: Raster, opacity: number): Raster {
  const data = Buffer.from(raster.data);
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i]! * opacity);
  return { data, width: raster.width, height: raster.height };
}

/** Rotate with the head. The canvas grows to fit the corners, so the new size matters. */
async function turn(raster: Raster, degrees: number): Promise<Raster> {
  const { data, info } = await sharp(raster.data, {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The part of a layer that actually lands on the image, or null if none of it does. */
async function clipToFrame(
  raster: Raster,
  origin: { left: number; top: number },
  width: number,
  height: number,
): Promise<(Raster & { left: number; top: number }) | null> {
  const left = Math.max(0, origin.left);
  const top = Math.max(0, origin.top);
  const right = Math.min(width, origin.left + raster.width);
  const bottom = Math.min(height, origin.top + raster.height);
  if (right - left < 1 || bottom - top < 1) return null;
  if (right - left === raster.width && bottom - top === raster.height) {
    return { ...raster, left, top };
  }

  const { data, info } = await sharp(raster.data, {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  })
    .extract({
      left: left - origin.left,
      top: top - origin.top,
      width: right - left,
      height: bottom - top,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, left, top };
}

interface Art {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Lens art, read once per process.
 *
 * Names come from `RECIPES` and never from a request, so there is nothing here for a
 * caller to point at a file of their choosing. Cached because these are a few kilobytes
 * of XML that cannot change while the server is running.
 */
const artCache = new Map<string, Art>();

async function loadArt(name: string): Promise<Art> {
  const cached = artCache.get(name);
  if (cached) return cached;

  const data = await readFile(path.join(process.cwd(), "public", "lenses", name));
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) throw new MediaError("Lens art could not be read.");
  const art = { data, width: meta.width, height: meta.height };
  artCache.set(name, art);
  return art;
}


