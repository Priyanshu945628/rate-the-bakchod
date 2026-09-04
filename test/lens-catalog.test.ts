import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLOUR_LENSES,
  FACE_LENSES,
  LENSES,
  ORIGINAL,
  filterCss,
  isFaceLens,
  lensById,
} from "@/lib/lenses/catalog";
import { RECIPES, recipeArt } from "@/lib/lenses/recipes";

/**
 * The dial, and the recipes behind the half of it the server draws.
 *
 * Everything here is a wiring check rather than a taste one. A lens is spread over three
 * places — a catalog entry, a recipe, and drawings on disk — and any of the three can go
 * missing without a type error: a recipe naming art that was never committed fails at the
 * shutter with a file-not-found, a face lens with no recipe fails with "Unknown lens", and
 * a swatch that 404s leaves a hole in the strip. All three are one typo away and none of
 * them are visible until somebody opens the camera.
 */

const PUBLIC = path.join(process.cwd(), "public");

describe("the dial", () => {
  it("starts on the untouched original", () => {
    expect(LENSES[0]?.id).toBe(ORIGINAL);
    expect(LENSES[0]?.css).toBe("");
    expect(LENSES[0]?.kind).toBe("colour");
  });

  it("holds every lens exactly once, under its own name", () => {
    expect(LENSES).toHaveLength(FACE_LENSES.length + COLOUR_LENSES.length);
    expect(new Set(LENSES.map((lens) => lens.id)).size).toBe(LENSES.length);
    expect(new Set(LENSES.map((lens) => lens.label)).size).toBe(LENSES.length);
  });

  it("puts the face lenses in front of the colour presets", () => {
    const kinds = LENSES.map((lens) => lens.kind).join(" ");
    expect(kinds).toMatch(/^colour( face)+( colour)+$/);
  });

  it("resolves an id to its own entry, and an unknown one to nothing", () => {
    for (const lens of LENSES) expect(lensById(lens.id)).toBe(lens);
    expect(lensById("no-such-lens")).toBeUndefined();
  });
});

describe("filterCss", () => {
  it("gives a colour preset its own string", () => {
    for (const lens of COLOUR_LENSES) expect(filterCss(lens.id)).toBe(lens.css);
  });

  /**
   * The important one. A face lens is already drawn into the bytes the server sent back,
   * so a CSS filter here would apply a second effect on top of the first — and an id left
   * over in stale state must leave the picture alone rather than throw mid-send.
   */
  it("gives nothing to a face lens or an unknown id", () => {
    for (const lens of FACE_LENSES) expect(filterCss(lens.id)).toBe("");
    expect(filterCss("no-such-lens")).toBe("");
  });
});

describe("face lenses", () => {
  it("are exactly the lenses with a recipe", () => {
    expect(Object.keys(RECIPES).sort()).toEqual(FACE_LENSES.map((lens) => lens.id).sort());
    for (const lens of FACE_LENSES) expect(isFaceLens(lens.id)).toBe(true);
    for (const lens of COLOUR_LENSES) expect(isFaceLens(lens.id)).toBe(false);
  });

  it("carry a swatch that exists on disk", () => {
    for (const lens of FACE_LENSES) {
      expect(lens.swatch).toMatch(/^\/lenses\/[\w-]+\.svg$/);
      expect(existsSync(path.join(PUBLIC, lens.swatch)), lens.swatch).toBe(true);
    }
  });

  it("carry no CSS, since the browser is not what draws them", () => {
    for (const lens of FACE_LENSES) expect(lens.css).toBe("");
  });
});

describe("recipes", () => {
  it("name art that exists on disk", () => {
    const art = recipeArt();
    expect(art.length).toBeGreaterThan(0);
    for (const file of art) {
      expect(existsSync(path.join(PUBLIC, "lenses", file)), file).toBe(true);
    }
  });

  it("draw something, at a size worth drawing", () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
      expect(recipe.layers.length, id).toBeGreaterThan(0);
      for (const layer of recipe.layers) {
        expect(layer.width, `${id}/${layer.art}`).toBeGreaterThan(0);
        // Eye spans, not pixels. Four of them is wider than any head in any photo, so a
        // number that large is a fraction someone forgot to convert.
        expect(layer.width, `${id}/${layer.art}`).toBeLessThanOrEqual(4);
        if (layer.opacity !== undefined) {
          expect(layer.opacity, `${id}/${layer.art}`).toBeGreaterThan(0);
          expect(layer.opacity, `${id}/${layer.art}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  /** `corner` only means anything to a layer that is placed against the frame. */
  it("only corner-pin frame layers", () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
      for (const layer of recipe.layers) {
        if (layer.corner) expect(layer.anchor, `${id}/${layer.art}`).toBe("frame");
      }
    }
  });

  it("keep skin smoothing within a sane range", () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
      const smooth = recipe.tone?.smooth;
      if (!smooth) continue;
      expect(smooth.sigma, id).toBeGreaterThan(0);
      expect(smooth.sigma, id).toBeLessThanOrEqual(8);
      expect(smooth.strength, id).toBeGreaterThan(0);
      // Full strength would replace the face with the blurred copy outright, erasing the
      // eyes along with the pores.
      expect(smooth.strength, id).toBeLessThan(0.8);
    }
  });
});
