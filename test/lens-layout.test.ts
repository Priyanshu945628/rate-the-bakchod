import { describe, expect, it } from "vitest";
import { faceFrame, type Detected } from "@/lib/lenses/geometry";
import { frameOrigin, layerCentre, layerSize, turns } from "@/lib/lenses/layout";
import type { LensLayer } from "@/lib/lenses/recipes";

/**
 * The arithmetic both drawers share.
 *
 * `render.ts` runs this through sharp to make the bytes that get sent; `lens-stage.tsx`
 * runs it on a canvas to show the preview. Testing it once is the point of it being one
 * module — a preview that placed art by its own reckoning could disagree with the photo,
 * and the disagreement would only ever be found after the shutter.
 */

/** Pupils 100px apart, upright, 40px in from the left of a 220px box. */
function upright(): Detected {
  return {
    x: 100,
    y: 100,
    width: 220,
    height: 260,
    eyes: [
      { cx: 160, cy: 200 },
      { cx: 260, cy: 200 },
    ],
  };
}

function tilted(): Detected {
  return {
    ...upright(),
    eyes: [
      { cx: 160, cy: 150 },
      { cx: 260, cy: 250 },
    ],
  };
}

const art = { width: 400, height: 200 };

function layer(over: Partial<LensLayer> = {}): LensLayer {
  return { art: "moustache.svg", anchor: "nose", width: 2, ...over };
}

describe("layerSize", () => {
  /** Facial art is measured in eye spans. Two spans of a 100px span is 200px. */
  it("scales facial art off the eye span, keeping the drawing's own ratio", () => {
    const size = layerSize(layer({ width: 1.85 }), art, faceFrame(upright()), 1000, 1000);
    expect(size.width).toBe(185);
    expect(size.height).toBe(Math.round((185 * 200) / 400));
  });

  it("grows facial art with the face rather than with the picture", () => {
    const frame = faceFrame(upright());
    const small = layerSize(layer(), art, frame, 800, 600);
    // Ten times the picture, same eyes in it: the same art.
    expect(layerSize(layer(), art, frame, 8000, 6000)).toEqual(small);

    const wide = faceFrame({
      ...upright(),
      eyes: [
        { cx: 110, cy: 200 },
        { cx: 310, cy: 200 },
      ],
    });
    expect(wide.eyeSpan).toBeCloseTo(frame.eyeSpan * 2, 5);
    expect(layerSize(layer(), art, wide, 800, 600).width).toBe(small.width * 2);
  });

  it("measures frame art off the picture instead", () => {
    const size = layerSize(
      layer({ anchor: "frame", width: 0.25, corner: "bl" }),
      art,
      faceFrame(upright()),
      800,
      600,
    );
    expect(size).toEqual({ width: 200, height: 100 });
  });

  /**
   * The one case with no ratio to keep. A glow or a scatter of bokeh has no shape to
   * distort, and letterboxing it inside the frame would leave a visible edge.
   */
  it("stretches a full-frame overlay to fit exactly", () => {
    const size = layerSize(layer({ anchor: "frame", width: 1 }), art, faceFrame(upright()), 800, 600);
    expect(size).toEqual({ width: 800, height: 600 });
  });

  it("still keeps the ratio of a corner sticker a whole frame wide", () => {
    const size = layerSize(
      layer({ anchor: "frame", width: 1, corner: "br" }),
      art,
      faceFrame(upright()),
      800,
      600,
    );
    expect(size).toEqual({ width: 800, height: 400 });
  });
});

describe("layerCentre", () => {
  it("lands on the anchor when the layer asks for no offset of its own", () => {
    const frame = faceFrame(upright());
    expect(layerCentre(layer({ anchor: "eyes" }), frame)).toEqual(frame.origin);
  });

  it("measures a layer's own offset in eye spans, down the face", () => {
    const frame = faceFrame(upright());
    const centre = layerCentre(layer({ anchor: "mouth", dy: 0.74 }), frame);
    // Mouth is 1.05 spans below the eyes, and the beard hangs 0.74 further.
    expect(centre.x).toBeCloseTo(210, 5);
    expect(centre.y).toBeCloseTo(200 + (1.05 + 0.74) * 100, 5);
  });

  /** The reason offsets are in the face's axes and not the picture's. */
  it("follows a tilted head rather than the picture", () => {
    const centre = layerCentre(layer({ anchor: "eyes", dy: 1 }), faceFrame(tilted()));
    expect(centre.x).toBeCloseTo(210 - 100, 5);
    expect(centre.y).toBeCloseTo(200 + 100, 5);
  });
});

describe("frameOrigin", () => {
  const size = { width: 120, height: 80 };

  it("insets a corner sticker by a fraction of the shorter edge", () => {
    const inset = Math.round(600 * 0.06);
    expect(frameOrigin(layer({ anchor: "frame", corner: "tl" }), size, 800, 600)).toEqual({
      left: inset,
      top: inset,
    });
    expect(frameOrigin(layer({ anchor: "frame", corner: "br" }), size, 800, 600)).toEqual({
      left: 800 - 120 - inset,
      top: 600 - 80 - inset,
    });
  });

  it("keeps every corner the same distance from its own two edges", () => {
    const at = (corner: LensLayer["corner"]) =>
      frameOrigin(layer({ anchor: "frame", corner }), size, 800, 600);
    expect(at("tl").top).toBe(at("tr").top);
    expect(at("bl").top).toBe(at("br").top);
    expect(at("tl").left).toBe(at("bl").left);
    expect(at("tr").left).toBe(at("br").left);
  });

  it("puts a full-frame overlay at the origin", () => {
    expect(frameOrigin(layer({ anchor: "frame" }), { width: 800, height: 600 }, 800, 600)).toEqual({
      left: 0,
      top: 0,
    });
  });
});

describe("turns", () => {
  it("turns facial art with a head that is actually tilted", () => {
    expect(turns(layer(), faceFrame(tilted()))).toBe(true);
  });

  /** Below the deadzone a rotation is a resample that changes nothing visible. */
  it("leaves art alone on a head that is barely off level", () => {
    const barely = faceFrame({
      ...upright(),
      eyes: [
        { cx: 160, cy: 200 },
        { cx: 260, cy: 201 },
      ],
    });
    expect(Math.abs(barely.roll)).toBeLessThan(2);
    expect(turns(layer(), barely)).toBe(false);
  });

  it("never turns art the recipe pinned", () => {
    expect(turns(layer({ fixed: true }), faceFrame(tilted()))).toBe(false);
  });

  /**
   * Frame art is pinned to the picture, not the head. Turning a rectangle that covers the
   * frame only uncovers its corners.
   */
  it("never turns frame art, whatever the head is doing", () => {
    expect(turns(layer({ anchor: "frame", width: 1 }), faceFrame(tilted()))).toBe(false);
    expect(turns(layer({ anchor: "frame", corner: "bl" }), faceFrame(tilted()))).toBe(false);
  });
});
