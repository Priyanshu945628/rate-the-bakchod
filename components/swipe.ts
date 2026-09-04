/**
 * Reading a drag on a touch screen as a page turn.
 *
 * Its own module because the two numbers are the whole feature, and neither can be
 * checked by looking at it: too short a threshold and a tap landing off a shaky thumb
 * pages the story, too long and the gesture stops answering. The axis test is what
 * keeps a vertical drag out of it — a swipe has to be more sideways than not.
 */

/** How far a thumb travels before it meant it, in CSS pixels. */
export const SWIPE_MIN_PX = 44;

export type Swipe = "next" | "previous" | null;

/**
 * `dx`/`dy` are end minus start, so a leftward drag is negative — and left is
 * forward, the direction the pages themselves move.
 */
export function readSwipe(dx: number, dy: number): Swipe {
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? "next" : "previous";
}
