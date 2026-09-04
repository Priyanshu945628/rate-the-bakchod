/**
 * What each face lens is made of.
 *
 * A lens is a tone change and a list of layers, and nothing else — no code per lens. The
 * point is that "and more of these" stays a data change: a drawing in `public/lenses/`
 * and an entry here.
 *
 * Every measurement is in **eye spans** (see `geometry.ts`), so a lens is the same lens
 * on a phone selfie and on a 1600px still, and on a small face and a large one.
 *
 * One convention makes eye-anchored art work: art anchored to `eyes` is drawn with its
 * own eyes at 25% and 75% of its width, so rendering it at `width: 2` puts them exactly
 * on the real pair. Glasses go slightly wider than that; a horse head goes much wider,
 * which is the joke.
 */

import type { AnchorName } from "./geometry";

/** libvips blend modes, narrowed to the handful the art uses. */
export type Blend = "over" | "multiply" | "screen" | "soft-light" | "overlay";

export interface LensLayer {
  /** File under `public/lenses/`. */
  art: string;
  anchor: AnchorName;
  /**
   * Width, in eye spans. For a `frame` layer, a fraction of the frame's width instead —
   * and `1` there means cover the frame exactly.
   */
  width: number;
  /** Extra offset from the anchor, in eye spans, along the face's own axes. */
  dx?: number;
  dy?: number;
  blend?: Blend;
  /** Uniform alpha applied to the drawing, 0–1. */
  opacity?: number;
  /** Skip the roll rotation. For art where rotating changes nothing visible. */
  fixed?: boolean;
  /** Where a `frame` layer sits. Absent means stretched over the whole frame. */
  corner?: "tl" | "tr" | "bl" | "br";
}

export interface LensTone {
  /** Passed to sharp's `modulate`. */
  brightness?: number;
  saturation?: number;
  /**
   * Soft skin over the face only: blur the picture, then bring the blurred copy back
   * through a feathered oval at `strength` alpha. Frequency separation for the price of
   * two passes — it softens pores and keeps the eyes and the edge of the face sharp,
   * because the oval fades out before it reaches them.
   *
   * `sigma` is in eye spans per 100px, so the softening is the same at any resolution.
   */
  smooth?: { sigma: number; strength: number };
}

export interface LensRecipe {
  tone?: LensTone;
  layers: LensLayer[];
}

export const RECIPES: Record<string, LensRecipe> = {
  /**
   * The whole head, replaced. Deliberately oversized — a horse head scaled to a human
   * face reads as a mask, and scaled past it reads as the lens people expect.
   */
  horse: {
    layers: [{ art: "horse.svg", anchor: "eyes", width: 3.3, dy: -0.12 }],
  },

  dog: {
    layers: [
      { art: "dog-ears.svg", anchor: "eyes", width: 3.0 },
      { art: "dog-nose.svg", anchor: "nose", width: 1.05, dy: 0.04 },
      { art: "dog-tongue.svg", anchor: "mouth", width: 0.62, dy: 0.34 },
    ],
  },

  cat: {
    layers: [
      { art: "cat-ears.svg", anchor: "brow", width: 3.0, dy: -0.52 },
      { art: "cat-nose.svg", anchor: "nose", width: 2.7, dy: 0.04 },
    ],
  },

  /**
   * "Kids face": the softening and the flush, which is most of what that look is, plus
   * freckles and one sticker.
   */
  baby: {
    tone: { brightness: 1.06, saturation: 1.1, smooth: { sigma: 2.2, strength: 0.44 } },
    layers: [
      { art: "blush.svg", anchor: "cheekL", width: 0.76, blend: "soft-light", fixed: true },
      { art: "blush.svg", anchor: "cheekR", width: 0.76, blend: "soft-light", fixed: true },
      { art: "freckles.svg", anchor: "nose", width: 1.75, dy: -0.12, blend: "multiply", opacity: 0.62 },
      { art: "rattle.svg", anchor: "frame", width: 0.24, corner: "bl" },
    ],
  },

  /** Makeup: smoothing, a tint on the lips, lashes, and light that flatters. */
  glam: {
    tone: { brightness: 1.04, saturation: 1.12, smooth: { sigma: 2.2, strength: 0.42 } },
    layers: [
      {
        art: "blush.svg",
        anchor: "cheekL",
        width: 0.72,
        blend: "soft-light",
        opacity: 0.85,
        fixed: true,
      },
      {
        art: "blush.svg",
        anchor: "cheekR",
        width: 0.72,
        blend: "soft-light",
        opacity: 0.85,
        fixed: true,
      },
      { art: "lashes.svg", anchor: "eyes", width: 1.9 },
      { art: "lips.svg", anchor: "mouth", width: 0.9, dy: 0.02, blend: "soft-light" },
      { art: "glow.svg", anchor: "frame", width: 1, blend: "screen", opacity: 0.7 },
    ],
  },

  /** Uncle: the glasses, the moustache, the beard, and a sparkle over the lot. */
  uncle: {
    tone: { brightness: 1.02, saturation: 0.96 },
    layers: [
      { art: "beard.svg", anchor: "mouth", width: 2.5, dy: 0.74 },
      { art: "moustache.svg", anchor: "nose", width: 1.85, dy: 0.42 },
      { art: "glasses-round.svg", anchor: "eyes", width: 2.15 },
      { art: "sparkles.svg", anchor: "frame", width: 1, blend: "screen", opacity: 0.8 },
    ],
  },
};

/** Every art file a recipe names, for the tracing config and for tests. */
export function recipeArt(): string[] {
  const names = new Set<string>();
  for (const recipe of Object.values(RECIPES)) {
    for (const layer of recipe.layers) names.add(layer.art);
  }
  return [...names].sort();
}
