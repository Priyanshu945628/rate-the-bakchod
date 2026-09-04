import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  assumedFace,
  faceFrame,
  largestFace,
  offsetPoint,
  scaleDetection,
  shift,
  type AnchorName,
  type Detected,
  type FaceFrame,
} from "@/lib/lenses/geometry";

/**
 * The arithmetic between a detection and a place to draw.
 *
 * This is the half of a lens with no picture to check it against. Every number here comes
 * out looking plausible, and a sign flip or a missing normalisation shows up only as a
 * moustache on a forehead. It is also the half that runs on every single request, found
 * face or not — on real selfies the eye classifier returns two eyes about as often as it
 * returns one — so the fallbacks are load-bearing rather than defensive.
 *
 * The ratios (0.44 of the box for a span, 0.42 down it for the eye line) are written out
 * here rather than imported: a test that reads the constant it is checking would follow a
 * bad edit rather than catch one.
 */

/** A plain upright face, pupils 100px apart, for the cases that need only one. */
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

describe("faceFrame with both eyes", () => {
  it("measures the span, the axes and the midpoint off the eyes themselves", () => {
    const frame = faceFrame(upright());
    expect(frame.eyeSpan).toBeCloseTo(100, 5);
    expect(frame.roll).toBeCloseTo(0, 5);
    expect(frame.right).toEqual({ x: 1, y: 0 });
    expect(frame.down.x).toBeCloseTo(0, 5);
    expect(frame.down.y).toBe(1);
    expect(frame.origin).toEqual({ x: 210, y: 200 });
  });

  it("reads a tilted head as a rotated frame, not a wider one", () => {
    const frame = faceFrame({
      ...upright(),
      eyes: [
        { cx: 160, cy: 150 },
        { cx: 260, cy: 250 },
      ],
    });
    expect(frame.roll).toBeCloseTo(45, 5);
    expect(frame.eyeSpan).toBeCloseTo(Math.hypot(100, 100), 5);
    // Unit length and perpendicular. Every placement rides on both.
    expect(Math.hypot(frame.right.x, frame.right.y)).toBeCloseTo(1, 5);
    expect(Math.hypot(frame.down.x, frame.down.y)).toBeCloseTo(1, 5);
    expect(frame.right.x * frame.down.x + frame.right.y * frame.down.y).toBeCloseTo(0, 5);
  });

  it("does not care which eye the detector reported first", () => {
    const face = upright();
    expect(faceFrame({ ...face, eyes: [...face.eyes].reverse() })).toEqual(faceFrame(face));
  });

  it("ignores a stray third detection between the two", () => {
    const face = upright();
    const withNostril = { ...face, eyes: [...face.eyes, { cx: 205, cy: 240 }] };
    expect(faceFrame(withNostril)).toEqual(faceFrame(face));
  });
});

describe("faceFrame when the eyes are not there", () => {
  it("takes the span off the box, upright, when nothing was found", () => {
    const frame = faceFrame({ x: 100, y: 100, width: 220, height: 260, eyes: [] });
    expect(frame.eyeSpan).toBeCloseTo(220 * 0.44, 5);
    expect(frame.roll).toBeCloseTo(0, 5);
    expect(frame.right).toEqual({ x: 1, y: 0 });
    expect(frame.origin.x).toBe(210);
    expect(frame.origin.y).toBeCloseTo(100 + 260 * 0.42, 5);
  });

  /** One eye is worth having: the vertical is the half a box guesses worst, since how
      much chin the classifier included moves it. */
  it("lets a single eye pin the vertical", () => {
    const frame = faceFrame({
      x: 100,
      y: 100,
      width: 220,
      height: 260,
      eyes: [{ cx: 160, cy: 186 }],
    });
    expect(frame.origin).toEqual({ x: 210, y: 186 });
    expect(frame.eyeSpan).toBeCloseTo(220 * 0.44, 5);
  });

  /**
   * Two boxes over one eye. Believing them gives a span of a few pixels and a tilt
   * measured across it — microscopic art, spinning frame to frame.
   */
  it("rejects a pair too close together to be two eyes", () => {
    const eyes = [
      { cx: 160, cy: 190 },
      { cx: 200, cy: 240 },
    ];
    expect(eyes[1]!.cx - eyes[0]!.cx).toBeLessThan(220 * 0.28);
    const frame = faceFrame({ x: 100, y: 100, width: 220, height: 260, eyes });
    expect(frame.eyeSpan).toBeCloseTo(220 * 0.44, 5);
    expect(frame.roll).toBeCloseTo(0, 5);
    // Still worth the one eye it does have.
    expect(frame.origin).toEqual({ x: 210, y: 190 });
  });

  it("accepts a pair just wide enough", () => {
    const gap = 220 * 0.28 + 1;
    const frame = faceFrame({
      x: 100,
      y: 100,
      width: 220,
      height: 260,
      eyes: [
        { cx: 160, cy: 200 },
        { cx: 160 + gap, cy: 200 },
      ],
    });
    expect(frame.eyeSpan).toBeCloseTo(gap, 5);
  });

  /**
   * The cost of measuring that gap horizontally: a head lying on its side puts both eyes
   * in one column, so it is not measured and is drawn upright. Pinned as a limit of the
   * check rather than a bug in it — art landing roughly on a sideways head beats art
   * scaled off a two-pixel span.
   */
  it("treats a head fully on its side as upright", () => {
    const frame = faceFrame({
      x: 100,
      y: 100,
      width: 220,
      height: 260,
      eyes: [
        { cx: 210, cy: 150 },
        { cx: 210, cy: 250 },
      ],
    });
    expect(frame.roll).toBeCloseTo(0, 5);
    expect(frame.eyeSpan).toBeCloseTo(220 * 0.44, 5);
  });
});

describe("anchors", () => {
  it("hang off the eye line in the order a face has them", () => {
    const frame = faceFrame(upright());
    const y = (name: AnchorName) => anchorPoint(frame, name).y;
    expect(y("brow")).toBeLessThan(y("eyes"));
    expect(y("eyes")).toBeLessThan(y("nose"));
    expect(y("nose")).toBeLessThan(y("mouth"));
    expect(y("mouth")).toBeLessThan(y("chin"));
  });

  it("put the cheeks either side of centre, level with each other", () => {
    const frame = faceFrame(upright());
    const left = anchorPoint(frame, "cheekL");
    const right = anchorPoint(frame, "cheekR");
    expect(left.x).toBeLessThan(frame.origin.x);
    expect(right.x).toBeGreaterThan(frame.origin.x);
    expect(frame.origin.x - left.x).toBeCloseTo(right.x - frame.origin.x, 5);
    expect(left.y).toBeCloseTo(right.y, 5);
  });

  it("read the eyes as the origin and the face as the box's centre", () => {
    const frame = faceFrame(upright());
    expect(anchorPoint(frame, "eyes")).toEqual(frame.origin);
    expect(anchorPoint(frame, "face")).toEqual({ x: 210, y: 230 });
  });

  /** Frame art is pinned to the picture, so its origin is the picture's own corner. */
  it("read the frame as the top left of the image", () => {
    expect(anchorPoint(faceFrame(upright()), "frame")).toEqual({ x: 0, y: 0 });
  });

  /**
   * The reason the unit is the eye span. Twice the span means twice the drop to the chin,
   * on the same detector box — art that scaled off the box would instead breathe with it,
   * since the box wobbles a few per cent between frames.
   */
  it("scale with the eye span rather than with the box", () => {
    const drop = (frame: FaceFrame) => anchorPoint(frame, "chin").y - frame.origin.y;
    const near = faceFrame(upright());
    const wide = faceFrame({
      ...upright(),
      eyes: [
        { cx: 110, cy: 200 },
        { cx: 310, cy: 200 },
      ],
    });
    expect(wide.eyeSpan).toBeCloseTo(near.eyeSpan * 2, 5);
    expect(drop(wide)).toBeCloseTo(drop(near) * 2, 5);
  });
});

describe("shift", () => {
  it("moves along the image's axes on an upright face", () => {
    expect(shift(faceFrame(upright()), { x: 0, y: 0 }, 1, 2)).toEqual({ x: 100, y: 200 });
  });

  /**
   * What makes a tilted head work. A beard is below the mouth in the face's own frame, and
   * on a leaning head that direction is not down the picture — placed down the image it
   * would sit beside an ear.
   */
  it("follows the head on a tilted one", () => {
    const frame = faceFrame({
      ...upright(),
      eyes: [
        { cx: 160, cy: 150 },
        { cx: 260, cy: 250 },
      ],
    });
    const below = shift(frame, frame.origin, 0, 1);
    // Eye line sloping down to the right, so one span down the face is down *and* left.
    expect(below.x).toBeCloseTo(frame.origin.x - 100, 5);
    expect(below.y).toBeCloseTo(frame.origin.y + 100, 5);
  });

  it("measures an offset from the origin the same way", () => {
    const frame = faceFrame(upright());
    expect(offsetPoint(frame, -0.5, 0.25)).toEqual(shift(frame, frame.origin, -0.5, 0.25));
  });
});

describe("assumedFace", () => {
  /** A miss is common rather than exceptional, so the guess has to be inside the frame. */
  it("sits inside the picture, centred, where a selfie's face goes", () => {
    for (const [width, height] of [
      [1080, 1080],
      [1080, 1920],
      [1920, 1080],
      [480, 640],
    ] as const) {
      const face = assumedFace(width, height);
      const at = `${width}x${height}`;
      expect(face.x, at).toBeGreaterThanOrEqual(0);
      expect(face.y, at).toBeGreaterThanOrEqual(0);
      expect(face.x + face.width, at).toBeLessThanOrEqual(width);
      expect(face.y + face.height, at).toBeLessThanOrEqual(height);
      expect(face.x + face.width / 2, at).toBeCloseTo(width / 2, 0);
      // Upper middle: a face is not in the bottom half of a selfie.
      expect(face.y + face.height / 2, at).toBeLessThan(height / 2);
      expect(face.eyes, at).toEqual([]);
    }
  });

  it("is square and whole-pixel, so no layer lands on half of one", () => {
    const face = assumedFace(1281, 721);
    expect(face.width).toBe(face.height);
    for (const n of [face.x, face.y, face.width, face.height]) {
      expect(Number.isInteger(n), String(n)).toBe(true);
    }
  });
});

describe("scaleDetection", () => {
  /** Detection runs on a small greyscale copy, so every number it hands back is in that
      copy's pixels while compositing happens at full size. */
  it("carries the eyes up along with the box", () => {
    const found: Detected = {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      eyes: [{ cx: 15, cy: 25 }],
    };
    expect(scaleDetection(found, 2)).toEqual({
      x: 20,
      y: 40,
      width: 60,
      height: 80,
      eyes: [{ cx: 30, cy: 50 }],
    });
  });

  it("changes the frame it yields in size only, not in shape", () => {
    const face = upright();
    const frame = faceFrame(face);
    const big = faceFrame(scaleDetection(face, 3));
    expect(big.eyeSpan).toBeCloseTo(frame.eyeSpan * 3, 5);
    expect(big.roll).toBeCloseTo(frame.roll, 5);
    expect(big.right).toEqual(frame.right);
    expect(big.origin).toEqual({ x: frame.origin.x * 3, y: frame.origin.y * 3 });
  });
});

describe("largestFace", () => {
  /** Small boxes are nearly always false positives — a patterned shirt, a doorknob. */
  it("takes the biggest box, and nothing at all from nothing", () => {
    const small: Detected = { x: 0, y: 0, width: 40, height: 40, eyes: [] };
    const big: Detected = { x: 90, y: 90, width: 50, height: 60, eyes: [] };
    expect(largestFace([small, big])).toBe(big);
    expect(largestFace([big, small])).toBe(big);
    expect(largestFace([big])).toBe(big);
    expect(largestFace([])).toBeNull();
  });
});
