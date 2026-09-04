import { describe, expect, it } from "vitest";
import { SWIPE_MIN_PX, readSwipe } from "@/components/swipe";

/**
 * Paging a story with a thumb.
 *
 * The whole gesture is two comparisons, and both of them are the kind of thing that is
 * only ever caught on a real phone: a threshold that lets a tap through pages the story
 * out from under the person holding it, and a missing axis test turns every scroll into
 * a page turn. Cheap to pin down here, expensive to notice there.
 */

describe("readSwipe", () => {
  it("reads a leftward drag as forward", () => {
    // Left is next because that is the way the pages themselves travel.
    expect(readSwipe(-120, 0)).toBe("next");
  });

  it("reads a rightward drag as back", () => {
    expect(readSwipe(120, 0)).toBe("previous");
  });

  it("ignores a tap that wandered", () => {
    expect(readSwipe(0, 0)).toBeNull();
    expect(readSwipe(6, -4)).toBeNull();
    expect(readSwipe(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
  });

  it("takes a drag that just reaches the threshold", () => {
    expect(readSwipe(-SWIPE_MIN_PX, 0)).toBe("next");
    expect(readSwipe(SWIPE_MIN_PX, 0)).toBe("previous");
  });

  it("ignores a drag that is more up-and-down than sideways", () => {
    // A thumb heading down the screen is somebody scrolling past the viewer, and a
    // 45-degree drag is nobody's idea of a swipe either — it has to beat the vertical.
    expect(readSwipe(-80, -200)).toBeNull();
    expect(readSwipe(-80, 80)).toBeNull();
    expect(readSwipe(-200, 80)).toBe("next");
  });

  it("does not care which way the vertical wander went", () => {
    expect(readSwipe(-160, 40)).toBe("next");
    expect(readSwipe(-160, -40)).toBe("next");
  });
});
