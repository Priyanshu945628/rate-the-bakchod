"use client";

import { useEffect } from "react";

/**
 * Tells CSS how much of the screen the on-screen keyboard is eating.
 *
 * Writes two things onto `<html>` and nothing else: `--kb`, the covered height in
 * pixels, and `data-keyboard="open"` once that height is worth reacting to. Both are
 * described where they are consumed, at the bottom of `app/globals.css`.
 *
 * The measurement is `innerHeight - (visualViewport.height + offsetTop)`, not
 * `innerHeight - visualViewport.height`. The offset term matters: when iOS scrolls the
 * layout viewport up to reveal a focused field, the visual viewport is no longer
 * flush with the top of the layout, and without it the keyboard appears to shrink by
 * however far the page scrolled.
 *
 * The 120px floor is there because the visual viewport also changes for things that
 * are not a keyboard — a collapsing address bar, a pull-to-refresh overscroll, a
 * pinch-zoom. Those are tens of pixels; a keyboard is hundreds. Treating a 40px
 * toolbar collapse as "keyboard open" would hide the tab bar every time somebody
 * scrolled.
 *
 * Renders nothing, and only ever mounted on surfaces that actually care: the chat, and
 * the camera, which puts a caption field at the bottom of the screen too. Elsewhere
 * `--kb` stays at its `0px` default and every `calc()` reading it is inert.
 *
 * Two of them can be mounted at once — a camera opened from a chat — which is harmless:
 * both write the same measurement from the same events. The one that unmounts first
 * clears the properties, and the other restores them on the next viewport change, which
 * a keyboard closing always is.
 */

/** Below this, it is browser chrome moving, not a keyboard. */
const KEYBOARD_FLOOR = 120;

export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      // Coalesced: iOS fires `scroll` and `resize` together, several times, for one
      // keyboard opening.
      raf = requestAnimationFrame(() => {
        const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty("--kb", `${Math.round(covered)}px`);
        if (covered > KEYBOARD_FLOOR) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
      });
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      // Navigating away has to put the page back, or a stale inset keeps a hole at
      // the bottom of every screen that follows.
      root.style.removeProperty("--kb");
      delete root.dataset.keyboard;
    };
  }, []);

  return null;
}
