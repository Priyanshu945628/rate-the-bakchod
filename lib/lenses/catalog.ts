/**
 * The lens list, shared by the camera and the server that renders them.
 *
 * Two kinds sit in one strip, because to the person holding the phone they are the
 * same gesture — turn the dial, watch the picture change:
 *
 *   - a **colour** lens is one CSS filter string, applied in the browser. Live in the
 *     preview, baked into the pixels by canvas when Send is pressed.
 *   - a **face** lens is drawn on the server: OpenCV finds the face, sharp composites
 *     art onto it. It cannot be live — it lands when the shutter fires.
 *
 * Both carry a `swatch`, the round picture on the dial. A face lens shows its own art
 * rather than a processed thumbnail of you, which is what makes the strip free: no
 * round trip per swatch, and the dial is readable before a face is ever found.
 *
 * Adding a lens is a change to this file plus a recipe in `lib/lenses/recipes.ts` and
 * a drawing in `public/lenses/`. Nothing else knows the list.
 */

export type LensKind = "colour" | "face";

export interface Lens {
  id: string;
  label: string;
  kind: LensKind;
  /** CSS filter string for a colour lens; empty for a face lens and the original. */
  css: string;
  /** Art under `/lenses/`, shown on the dial. Empty for the original. */
  swatch: string;
}

/** The one every picture starts on. */
export const ORIGINAL = "original";

/**
 * Face lenses, in the order they appear after the original.
 *
 * First on the dial because they are the reason to open the camera; the colour presets
 * are the quieter half and sit behind them.
 */
export const FACE_LENSES: Lens[] = [
  { id: "horse", label: "Horse", kind: "face", css: "", swatch: "/lenses/horse.svg" },
  { id: "dog", label: "Doggo", kind: "face", css: "", swatch: "/lenses/swatch-dog.svg" },
  { id: "cat", label: "Kitty", kind: "face", css: "", swatch: "/lenses/swatch-cat.svg" },
  { id: "baby", label: "Baby", kind: "face", css: "", swatch: "/lenses/swatch-baby.svg" },
  { id: "glam", label: "Glam", kind: "face", css: "", swatch: "/lenses/swatch-glam.svg" },
  { id: "uncle", label: "Uncle", kind: "face", css: "", swatch: "/lenses/swatch-uncle.svg" },
];

/**
 * Colour presets — the eight the DM composer has always offered, unchanged.
 *
 * A swatch here is not a drawing: the dial paints a small skin-toned gradient and puts
 * the preset's own filter on it, so the chip shows what the preset does.
 */
export const COLOUR_LENSES: Lens[] = [
  { id: ORIGINAL, label: "Original", kind: "colour", css: "", swatch: "" },
  { id: "mono", label: "Mono", kind: "colour", css: "grayscale(1) contrast(1.12)", swatch: "" },
  {
    id: "noir",
    label: "Noir",
    kind: "colour",
    css: "grayscale(1) contrast(1.5) brightness(0.88)",
    swatch: "",
  },
  {
    id: "warm",
    label: "Warm",
    kind: "colour",
    css: "sepia(0.3) saturate(1.4) contrast(1.05)",
    swatch: "",
  },
  {
    id: "cool",
    label: "Cool",
    kind: "colour",
    css: "hue-rotate(-12deg) saturate(1.15) brightness(1.05) contrast(1.05)",
    swatch: "",
  },
  { id: "vivid", label: "Vivid", kind: "colour", css: "saturate(1.65) contrast(1.18)", swatch: "" },
  {
    id: "fade",
    label: "Fade",
    kind: "colour",
    css: "saturate(0.7) brightness(1.12) contrast(0.86)",
    swatch: "",
  },
  {
    id: "retro",
    label: "Retro",
    kind: "colour",
    css: "sepia(0.45) saturate(1.55) hue-rotate(-18deg) contrast(1.12)",
    swatch: "",
  },
];

/** The dial, in order: original, then the face lenses, then the colour presets. */
export const LENSES: Lens[] = [
  COLOUR_LENSES[0]!,
  ...FACE_LENSES,
  ...COLOUR_LENSES.slice(1),
];

export function lensById(id: string): Lens | undefined {
  return LENSES.find((lens) => lens.id === id);
}

/** True for a lens the server has to draw. */
export function isFaceLens(id: string): boolean {
  return lensById(id)?.kind === "face";
}

/**
 * A lens's CSS filter, falling back to leaving the picture alone.
 *
 * Face lenses answer empty here, which is what keeps the browser from double-applying
 * anything to bytes the server has already drawn on, and an id from stale state answers
 * empty too — the picture as it was taken beats a throw in the middle of a send.
 */
export function filterCss(id: string): string {
  return lensById(id)?.css ?? "";
}
