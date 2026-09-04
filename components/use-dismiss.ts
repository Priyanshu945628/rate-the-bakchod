"use client";

import { useEffect, type RefObject } from "react";

/**
 * Close a popover on a press elsewhere, or on Escape.
 *
 * Both listeners live on the document and are attached only while the thing is open,
 * because a click outside is by definition not on anything the component rendered —
 * there is no element of its own to hang an `onBlur` from. `mousedown` rather than
 * `click`, so a press that starts outside dismisses even if the pointer travels back
 * in before it is released.
 */
export function useDismiss(
  open: boolean,
  wrap: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, wrap, close]);
}
