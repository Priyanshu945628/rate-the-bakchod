/**
 * Turning a detection into places to draw.
 *
 * OpenCV gives back a box and, when it is lucky, an eye or two. Everything a lens needs
 * — where the brow is, which way the head is tilted, how big to draw a moustache — is
 * derived here, in one place, in pure arithmetic that can be tested without a camera.
 *
 * The unit is the **eye span**, the distance between the pupils. Faces differ in shape
 * far more than they differ in the ratio of their features to that one measurement, so a
 * moustache 1.85 eye spans wide is the right moustache on a narrow face and a wide one.
 * The alternative, scaling by the detector's box, drifts: the box wobbles by a few per
 * cent between frames and grows when a chin is included, which would make art breathe.
 *
 * Eyes are the unreliable part in practice — on real selfies the classifier finds two
 * about as often as it finds one — so every derivation below has a defined answer with
 * one eye, and with none.
 */

export interface Point {
  x: number;
  y: number;
}

/** What the detector reports, in pixels of the image it looked at. */
export interface Detected {
  x: number;
  y: number;
  width: number;
  height: number;
  eyes: { cx: number; cy: number }[];
}

export type AnchorName =
  | "eyes"
  | "brow"
  | "nose"
  | "mouth"
  | "chin"
  | "cheekL"
  | "cheekR"
  | "face"
  | "frame";

export interface FaceFrame {
  /** Pupil to pupil, px. The unit every facial layer is measured in. */
  eyeSpan: number;
  /** Head tilt, degrees clockwise. Zero whenever it could not be measured. */
  roll: number;
  /** Unit vector along the eye line, left to right. */
  right: Point;
  /** Unit vector down the face, perpendicular to `right`. */
  down: Point;
  /** Midpoint of the eyes — the origin every offset is measured from. */
  origin: Point;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Interocular distance as a fraction of the detector's box width.
 *
 * Measured off the `alt2` cascade, whose box is roughly temple to temple. Used whenever
 * the eyes themselves are missing, which is most of the time.
 */
const EYE_SPAN_RATIO = 0.44;

/** Where the eye line sits down the box, used only when no eye was found at all. */
const EYE_LINE_RATIO = 0.42;

/**
 * Feature offsets from the eye line, in eye spans, down the face axis.
 *
 * Rough averages of adult proportions, tuned by eye against the reference shots rather
 * than measured — the aim is a lens that lands convincingly, not anthropometry.
 */
const OFFSETS: Record<Exclude<AnchorName, "face" | "frame" | "eyes">, Point> = {
  brow: { x: 0, y: -0.55 },
  nose: { x: 0, y: 0.62 },
  mouth: { x: 0, y: 1.05 },
  chin: { x: 0, y: 1.62 },
  cheekL: { x: -0.66, y: 0.55 },
  cheekR: { x: 0.66, y: 0.55 },
};

/**
 * Build the frame a lens is drawn in.
 *
 * With two eyes everything is measured: span, tilt, and the line they sit on. With one,
 * the eye still pins the vertical — which is the harder half to guess, since a box's
 * height depends on how much chin the classifier included — and the box supplies the
 * width. With none, both come from the box and the head is assumed upright.
 */
export function faceFrame(face: Detected): FaceFrame {
  const box = { x: face.x, y: face.y, width: face.width, height: face.height };
  const centreX = face.x + face.width / 2;

  // Two eyes are two *different* eyes: a pair whose centres nearly coincide is one eye
  // found twice, and the tilt derived from it would be noise multiplied by a long lever.
  const pair = pickPair(face.eyes, face.width);

  if (pair) {
    const [left, right] = pair;
    const dx = right.cx - left.cx;
    const dy = right.cy - left.cy;
    const eyeSpan = Math.hypot(dx, dy);
    const roll = (Math.atan2(dy, dx) * 180) / Math.PI;
    return {
      eyeSpan,
      roll,
      right: { x: dx / eyeSpan, y: dy / eyeSpan },
      down: { x: -dy / eyeSpan, y: dx / eyeSpan },
      origin: { x: (left.cx + right.cx) / 2, y: (left.cy + right.cy) / 2 },
      box,
    };
  }

  const eyeSpan = face.width * EYE_SPAN_RATIO;
  const one = face.eyes[0];
  return {
    eyeSpan,
    roll: 0,
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    origin: {
      x: centreX,
      y: one ? one.cy : face.y + face.height * EYE_LINE_RATIO,
    },
    box,
  };
}

/**
 * The two eyes furthest apart, if there really are two.
 *
 * Rejects a pair closer together than 28% of the face's width — at that distance it is
 * the same eye detected twice, or an eye and a nostril.
 */
function pickPair(
  eyes: { cx: number; cy: number }[],
  faceWidth: number,
): [{ cx: number; cy: number }, { cx: number; cy: number }] | null {
  if (eyes.length < 2) return null;
  const sorted = [...eyes].sort((a, b) => a.cx - b.cx);
  const left = sorted[0]!;
  const right = sorted[sorted.length - 1]!;
  if (right.cx - left.cx < faceWidth * 0.28) return null;
  return [left, right];
}

/** Where an anchor lands, in image pixels. */
export function anchorPoint(frame: FaceFrame, anchor: AnchorName): Point {
  if (anchor === "eyes") return frame.origin;
  if (anchor === "face") {
    return { x: frame.box.x + frame.box.width / 2, y: frame.box.y + frame.box.height / 2 };
  }
  if (anchor === "frame") return { x: 0, y: 0 };
  return offsetPoint(frame, OFFSETS[anchor].x, OFFSETS[anchor].y);
}

/** A point `dx` right and `dy` down the face's own axes, both in eye spans. */
export function offsetPoint(frame: FaceFrame, dx: number, dy: number): Point {
  return shift(frame, frame.origin, dx, dy);
}

/**
 * Move a point along the face's axes rather than the image's.
 *
 * This is what makes a tilted head work. A beard is "below the mouth" in the face's own
 * frame of reference, and on a head leaning 20° that direction is not down the picture.
 */
export function shift(frame: FaceFrame, from: Point, dx: number, dy: number): Point {
  return {
    x: from.x + frame.right.x * dx * frame.eyeSpan + frame.down.x * dy * frame.eyeSpan,
    y: from.y + frame.right.y * dx * frame.eyeSpan + frame.down.y * dy * frame.eyeSpan,
  };
}


/**
 * The face to use when nothing was found.
 *
 * A miss is common rather than exceptional — a beard, glasses, a head turned a little,
 * bad light — and the request is not worth failing over. So a box is assumed where a
 * selfie's face nearly always is: centred, in the upper middle, about two thirds of the
 * shorter edge across. The lens lands somewhere plausible, and the person can see it
 * missed and pick another.
 */
export function assumedFace(width: number, height: number): Detected {
  const size = Math.round(Math.min(width, height) * 0.62);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round(height * 0.3 - size / 2 + size * 0.08),
    width: size,
    height: size,
    eyes: [],
  };
}

/**
 * Scale a detection from the size it was found at back to the size being drawn.
 *
 * Detection runs on a small greyscale copy — it is quadratic in pixels and gains nothing
 * from resolution — while compositing happens at full size.
 */
export function scaleDetection(face: Detected, factor: number): Detected {
  return {
    x: face.x * factor,
    y: face.y * factor,
    width: face.width * factor,
    height: face.height * factor,
    eyes: face.eyes.map((eye) => ({ cx: eye.cx * factor, cy: eye.cy * factor })),
  };
}

/** The biggest of several detections. Small boxes are nearly always false positives. */
export function largestFace(faces: Detected[]): Detected | null {
  let best: Detected | null = null;
  for (const face of faces) {
    if (!best || face.width * face.height > best.width * best.height) best = face;
  }
  return best;
}
