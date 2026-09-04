import { describe, expect, it } from "vitest";
import {
  ORIGINAL,
  PHOTO_FILTERS,
  filterCss,
} from "@/components/messages/photo-filters";

/**
 * The presets behind the strip under a photo in the composer.
 *
 * `renderPhoto` itself needs a canvas and cannot run here, so what is pinned down is
 * the part that can go wrong silently: an invalid CSS filter function makes the *whole*
 * declaration invalid, and both `style.filter` and `ctx.filter` drop an invalid
 * declaration without complaining. One typo in one preset would mean a swatch that
 * changes nothing, in every browser, with nothing in the console to say why.
 */

/** Every filter function CSS actually has. Anything else is a typo. */
const FILTER_FUNCTIONS = new Set([
  "blur",
  "brightness",
  "contrast",
  "drop-shadow",
  "grayscale",
  "hue-rotate",
  "invert",
  "opacity",
  "saturate",
  "sepia",
]);

const PART = /^([a-z-]+)\(([^()]+)\)$/;

describe("PHOTO_FILTERS", () => {
  it("starts on the untouched original", () => {
    expect(PHOTO_FILTERS[0]?.id).toBe(ORIGINAL);
    expect(PHOTO_FILTERS[0]?.css).toBe("");
  });

  it("has one entry per id and per label", () => {
    const ids = PHOTO_FILTERS.map((preset) => preset.id);
    const labels = PHOTO_FILTERS.map((preset) => preset.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names only filter functions that exist", () => {
    for (const preset of PHOTO_FILTERS) {
      if (preset.id === ORIGINAL) continue;
      const parts = preset.css.split(" ");
      expect(parts.length, preset.id).toBeGreaterThan(0);
      for (const part of parts) {
        const match = PART.exec(part);
        expect(match, `${preset.id}: ${part}`).not.toBeNull();
        expect(FILTER_FUNCTIONS.has(match![1]!), `${preset.id}: ${match![1]}`).toBe(true);
      }
    }
  });

  it("changes something in every preset but the original", () => {
    for (const preset of PHOTO_FILTERS) {
      if (preset.id === ORIGINAL) continue;
      expect(preset.css.length, preset.id).toBeGreaterThan(0);
    }
  });
});

describe("filterCss", () => {
  it("gives back the preset's own string", () => {
    for (const preset of PHOTO_FILTERS) {
      expect(filterCss(preset.id)).toBe(preset.css);
    }
  });

  it("leaves the photo alone for an id it does not know", () => {
    // A stale id can only come from this app's own state, so the safe answer is the
    // picture as it was picked rather than a throw in the middle of a send.
    expect(filterCss("no-such-filter")).toBe("");
    expect(filterCss("")).toBe("");
  });
});
