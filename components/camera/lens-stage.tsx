"use client";

/**
 * The live lens.
 *
 * A canvas over the viewfinder that draws what the shutter is going to produce: the frame,
 * the tone, the skin smoothing, and the recipe's art placed on the face. It exists because
 * a lens you cannot see until after the photo is not a lens you can aim.
 *
 * The split of work is the whole design. Finding the face stays on the server, where OpenCV
 * already is — the browser sends a small greyscale-able frame every 650ms and gets back a
 * box and its eyes. Drawing is local and runs on every animation frame, so the art tracks
 * the head at the display's rate rather than at the network's.
 *
 * Placement comes from `lib/lenses/layout.ts`, the same module sharp uses in `render.ts`.
 * That is deliberate and load-bearing: a preview with its own copy of the arithmetic is a
 * preview that can lie, and the lie would only ever surface after the shutter.
 *
 * It never goes blank. Before the first detection lands, and after a miss, the art sits on
 * `assumedFace` or on the last place a face was — a filter that vanishes looks broken, and
 * one that is slightly off looks like a filter.
 */

import { useEffect, useRef, type RefObject } from "react";
import {
  assumedFace,
  faceFrame,
  scaleDetection,
  type Detected,
  type FaceFrame,
} from "@/lib/lenses/geometry";
import { frameOrigin, layerCentre, layerSize, turns } from "@/lib/lenses/layout";
import { RECIPES, type Blend, type LensLayer, type LensRecipe } from "@/lib/lenses/recipes";
import { fit } from "../photo-filters";

/** Longest edge the preview is drawn at. Matches what the clip recorder uses. */
const PREVIEW_EDGE = 1280;

/** Longest edge of the frame posted for tracking. Small on purpose — it is an upload. */
const GRAB_EDGE = 384;

/** How often the face is looked for. Slower than a blink, faster than a pose change. */
const TRACK_MS = 650;

/** Consecutive failures before tracking gives up for this session. */
const GIVE_UP = 4;

/**
 * How far the drawn face moves toward each new detection, per frame.
 *
 * Detections arrive a couple of frames apart and jitter by a few pixels even on a still
 * head. Easing turns that into a drift nobody notices; drawing them raw makes the art
 * twitch every time one lands.
 */
const EASE = 0.25;

/** The smoothing pass runs at half size. A blur is a low-pass; the detail was leaving anyway. */
const SOFT_SCALE = 0.5;

const BLENDS: Record<Blend, GlobalCompositeOperation> = {
  over: "source-over",
  multiply: "multiply",
  screen: "screen",
  "soft-light": "soft-light",
  overlay: "overlay",
};

/** Art, decoded once per page. A few KB of SVG that cannot change while the tab is open. */
const artCache = new Map<string, HTMLImageElement>();

function artFor(name: string): HTMLImageElement {
  const cached = artCache.get(name);
  if (cached) return cached;
  const img = new Image();
  img.decoding = "sync";
  img.src = `/lenses/${name}`;
  artCache.set(name, img);
  return img;
}

interface Props {
  /** The playing viewfinder. Read every frame; never touched. */
  video: RefObject<HTMLVideoElement | null>;
  /** Which face lens to draw. Changing it keeps the tracking already in hand. */
  lens: string;
  /** Mirrored the same way the video is, by CSS, so the art turns with the picture. */
  mirrored: boolean;
  /** Whether canvas filters work here. Without them, tone and smoothing are skipped. */
  tone: boolean;
}

export function LensStage({ video, lens, mirrored, tone }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** Where the face was last found, in the video's own pixels. */
  const target = useRef<Detected | null>(null);
  /** Where it is being drawn, eased toward `target`. */
  const shown = useRef<Detected | null>(null);
  /** Read by the draw loop, which must survive a lens change without restarting. */
  const recipe = useRef<LensRecipe | undefined>(RECIPES[lens]);

  useEffect(() => {
    recipe.current = RECIPES[lens];
    for (const layer of RECIPES[lens]?.layers ?? []) artFor(layer.art);
  }, [lens]);

  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;

    const scratch = document.createElement("canvas");
    const grabber = document.createElement("canvas");
    const abort = new AbortController();
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    let misses = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const source = video.current;
      const active = recipe.current;
      if (!active || !source || !source.videoWidth || !source.videoHeight) return;

      const size = fit(source.videoWidth, source.videoHeight, PREVIEW_EDGE);
      if (node.width !== size.width || node.height !== size.height) {
        node.width = size.width;
        node.height = size.height;
      }

      const found = target.current ?? assumedFace(source.videoWidth, source.videoHeight);
      shown.current = ease(shown.current, found);
      const frame = faceFrame(scaleDetection(shown.current, size.width / source.videoWidth));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = tone ? toneFilter(active) : "none";
      ctx.drawImage(source, 0, 0, size.width, size.height);
      ctx.filter = "none";

      const smooth = active.tone?.smooth;
      if (tone && smooth) softSkin(ctx, source, frame, size, smooth, scratch);
      for (const layer of active.layers) drawLayer(ctx, layer, frame, size);
    };
    raf = requestAnimationFrame(draw);

    const tick = async () => {
      const source = video.current;
      if (!live) return;
      if (document.hidden || !source?.videoWidth) return schedule();
      try {
        const face = await grab(source, grabber, abort.signal);
        if (!live) return;
        misses = 0;
        // A miss keeps the art where it was last seen. Snapping back to the centre of the
        // frame every time a blink loses the classifier would be worse than being late.
        if (face) target.current = face;
      } catch {
        if (!live) return;
        misses += 1;
      }
      if (misses < GIVE_UP) schedule();
    };
    const schedule = () => {
      timer = setTimeout(() => void tick(), TRACK_MS);
    };
    void tick();

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      abort.abort();
    };
  }, [video, tone]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
      // `object-cover`, matching the `<video>` underneath. Both have the frame's own aspect
      // and the same box, so the browser crops them identically and the art stays on the
      // face — no part of this has to know where the crop fell.
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** The recipe's tone as a CSS filter. sharp's `modulate` in the shape a canvas takes. */
function toneFilter(recipe: LensRecipe): string {
  const parts: string[] = [];
  if (recipe.tone?.brightness) parts.push(`brightness(${recipe.tone.brightness})`);
  if (recipe.tone?.saturation) parts.push(`saturate(${recipe.tone.saturation})`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

/**
 * One layer, at the size and place the server would put it.
 *
 * The difference from `render.ts` is only in how the turn is done: sharp rotates the art
 * and then places the grown rectangle, while here the canvas is rotated about the point the
 * art is centred on. Same result, and no need to know how big a rotation made something.
 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: LensLayer,
  frame: FaceFrame,
  canvasSize: { width: number; height: number },
) {
  const art = artFor(layer.art);
  if (!art.complete || !art.naturalWidth || !art.naturalHeight) return;

  const size = layerSize(
    layer,
    { width: art.naturalWidth, height: art.naturalHeight },
    frame,
    canvasSize.width,
    canvasSize.height,
  );
  if (size.width < 2 || size.height < 2) return;

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.globalCompositeOperation = BLENDS[layer.blend ?? "over"];
  if (layer.anchor === "frame") {
    const at = frameOrigin(layer, size, canvasSize.width, canvasSize.height);
    ctx.drawImage(art, at.left, at.top, size.width, size.height);
  } else {
    const centre = layerCentre(layer, frame);
    ctx.translate(centre.x, centre.y);
    if (turns(layer, frame)) ctx.rotate((frame.roll * Math.PI) / 180);
    ctx.drawImage(art, -size.width / 2, -size.height / 2, size.width, size.height);
  }
  ctx.restore();
}

/**
 * Blur the frame, then let it back through a feathered oval over the face — the same trick
 * `softSkin` in `render.ts` plays with sharp, and the same oval, so the preview softens what
 * the photo will soften.
 *
 * Run at half size, which is four times less blurring per frame and looks identical: the
 * detail the downscale loses is detail the blur was about to remove.
 */
function softSkin(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement,
  frame: FaceFrame,
  size: { width: number; height: number },
  smooth: { sigma: number; strength: number },
  scratch: HTMLCanvasElement,
) {
  const w = Math.max(2, Math.round(size.width * SOFT_SCALE));
  const h = Math.max(2, Math.round(size.height * SOFT_SCALE));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const s = scratch.getContext("2d");
  if (!s) return;

  // Scaled by the face, not the frame: the same sigma has to soften the same pores whether
  // the head fills the viewfinder or sits in the middle of it.
  const sigma = Math.min(60, Math.max(0.4, (smooth.sigma * frame.eyeSpan) / 100)) * SOFT_SCALE;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = "source-over";
  s.clearRect(0, 0, w, h);
  s.filter = `blur(${sigma.toFixed(2)}px)`;
  s.drawImage(source, 0, 0, w, h);
  s.filter = "none";

  const alpha = Math.min(1, Math.max(0, smooth.strength));
  const mask = s.createRadialGradient(0, 0, 0, 0, 0, 1);
  mask.addColorStop(0, `rgba(255,255,255,${alpha})`);
  mask.addColorStop(0.58, `rgba(255,255,255,${alpha})`);
  mask.addColorStop(1, "rgba(255,255,255,0)");

  // A unit circle scaled into an ellipse, which is what the SVG mask's `objectBoundingBox`
  // gradient amounts to. `destination-in` multiplies the blur's alpha by the mask's, so
  // everything outside the oval is dropped and the edge fades rather than cuts.
  s.globalCompositeOperation = "destination-in";
  s.translate((frame.box.x + frame.box.width / 2) * SOFT_SCALE, (frame.box.y + frame.box.height * 0.56) * SOFT_SCALE);
  s.scale(frame.box.width * 0.56 * SOFT_SCALE, frame.box.height * 0.68 * SOFT_SCALE);
  s.fillStyle = mask;
  s.fillRect(-1, -1, 2, 2);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = "source-over";

  ctx.drawImage(scratch, 0, 0, size.width, size.height);
}

/**
 * Ask the server where the face is.
 *
 * A small JPEG of the raw frame — not the mirrored one, since the video element is flipped
 * by CSS and its pixels are not — so the box comes back in the same coordinates everything
 * else here is measured in. Throws on anything but an answer; the caller counts failures.
 */
async function grab(
  source: HTMLVideoElement,
  grabber: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<Detected | null> {
  const size = fit(source.videoWidth, source.videoHeight, GRAB_EDGE);
  grabber.width = size.width;
  grabber.height = size.height;
  const ctx = grabber.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(source, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    grabber.toBlob(resolve, "image/jpeg", 0.7),
  );
  if (!blob) throw new Error("no frame");

  const body = new FormData();
  body.set("file", blob, "frame.jpg");
  const res = await fetch("/api/lens/track", { method: "POST", body, signal });
  if (!res.ok) throw new Error(`track ${res.status}`);

  const data = (await res.json()) as { width?: number; face?: Detected | null };
  if (!data.face || !data.width) return null;
  // Back into the video's own pixels. The server says what it looked at rather than
  // assuming, so this cannot drift when either side changes its working size.
  return scaleDetection(data.face, source.videoWidth / data.width);
}

/**
 * Move the drawn face a fraction of the way toward a new detection.
 *
 * Eyes are matched left to right before mixing: which eye the classifier reports first is
 * not stable between frames, and lerping one eye toward the other's position would swing
 * the art through a spin on the way.
 */
function ease(from: Detected | null, to: Detected): Detected {
  if (!from) return to;
  const mix = (a: number, b: number) => a + (b - a) * EASE;
  const before = [...from.eyes].sort((a, b) => a.cx - b.cx);
  const after = [...to.eyes].sort((a, b) => a.cx - b.cx);
  const eyes =
    before.length === after.length
      ? after.map((eye, i) => ({
          cx: mix(before[i]!.cx, eye.cx),
          cy: mix(before[i]!.cy, eye.cy),
        }))
      : after;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
    eyes,
  };
}

