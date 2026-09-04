/**
 * Where a layer goes, in pixels.
 *
 * Shared by the two things that draw a lens: sharp in `render.ts`, which makes the bytes
 * that get sent, and the canvas in `components/camera/lens-stage.tsx`, which shows the
 * preview. One copy of the arithmetic is the whole point — a preview that works out its
 * own placement is a preview that can disagree with the photo, and the disagreement would
 * only ever be found after the shutter.
 *
 * Pure: no sharp, no DOM. Sizes come in as plain numbers, whether they were read off an
 * SVG by libvips or by an `<img>`.
 */

import { anchorPoint, shift, type FaceFrame, type Point } from "./geometry";
import type { LensLayer } from "./recipes";

/** How far a corner sticker sits in, as a fraction of the shorter edge. */
export const CORNER_INSET = 0.06;

/** Rotating art by less than this is a resample that changes nothing. */
export const ROLL_DEADZONE = 2;

export interface Size {
  width: number;
  height: number;
}

/**
 * Layer size in pixels: eye spans for facial art, a fraction of the frame otherwise.
 *
 * A full-frame overlay is stretched to fit exactly. Bokeh and sparkle scatter have no
 * shape to distort, and letterboxing them would leave a visible edge.
 */
export function layerSize(
  layer: LensLayer,
  art: Size,
  frame: FaceFrame,
  width: number,
  height: number,
): Size {
  if (layer.anchor === "frame") {
    if (layer.width >= 1 && !layer.corner) return { width, height };
    const w = Math.round(layer.width * width);
    return { width: w, height: Math.round((w * art.height) / art.width) };
  }
  const w = Math.round(layer.width * frame.eyeSpan);
  return { width: w, height: Math.round((w * art.height) / art.width) };
}

/**
 * The point a facial layer is centred on: its anchor, plus its own offset along the face's
 * axes. Frame layers have no face to hang off — `frameOrigin` places those.
 */
export function layerCentre(layer: LensLayer, frame: FaceFrame): Point {
  const base = anchorPoint(frame, layer.anchor);
  if (!layer.dx && !layer.dy) return base;
  return shift(frame, base, layer.dx ?? 0, layer.dy ?? 0);
}

/** Top-left of a frame layer, at the size it is drawn. */
export function frameOrigin(
  layer: LensLayer,
  size: Size,
  width: number,
  height: number,
): { left: number; top: number } {
  const inset = Math.round(Math.min(width, height) * CORNER_INSET);
  const right = width - size.width - inset;
  const bottom = height - size.height - inset;
  if (layer.corner === "tl") return { left: inset, top: inset };
  if (layer.corner === "tr") return { left: right, top: inset };
  if (layer.corner === "bl") return { left: inset, top: bottom };
  if (layer.corner === "br") return { left: right, top: bottom };
  return { left: 0, top: 0 };
}

/**
 * Whether this layer turns with the head.
 *
 * Frame layers never do, whatever the head is doing: a glow or a scatter of sparkles is
 * pinned to the picture, and turning a rectangle that covers the frame only uncovers its
 * corners.
 */
export function turns(layer: LensLayer, frame: FaceFrame): boolean {
  if (layer.fixed || layer.anchor === "frame") return false;
  return Math.abs(frame.roll) > ROLL_DEADZONE;
}
