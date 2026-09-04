"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExpandIcon, XIcon } from "./icons";

/**
 * A picture, and the whole screen it opens onto.
 *
 * Every image in this app is drawn small — a chat bubble caps at 280px tall, a post at
 * 70vh — and what people send each other here is screenshots, which are exactly the
 * pictures that are unreadable at that size. So the thumbnail is a button, and the
 * button gives the picture the screen: fitted to it, or at actual size in a box that
 * pans, because a phone screenshot fitted to a phone is still a phone screenshot.
 *
 * The overlay is portalled to `document.body` rather than rendered where it is used.
 * `fixed inset-0` and `z-50` both mean "against the viewport, above everything" only
 * while no ancestor has claimed otherwise, and the chat panel a photo bubble sits in
 * isolates its own stacking context (`chat-glow`) — inside that, z-50 is 50 among the
 * bubbles. Body is the one parent that can promise nothing sits above it.
 */

export function ViewableImage({
  src,
  alt,
  className,
  wrapClassName,
  width,
  height,
  loading,
}: {
  src: string;
  alt: string;
  /** Classes for the `<img>`, exactly as if the button were not there. */
  className?: string;
  /** Classes for the button, where the trigger has to fill its own box. */
  wrapClassName?: string;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        // Named by its own contents where the picture has a description — a post
        // carries its caption. A chat photo has none, so it says so here instead.
        aria-label={alt.trim() ? undefined : "Open photo"}
        className={`block cursor-zoom-in ${wrapClassName ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          className={className}
        />
      </button>

      {open ? (
        <Overlay
          src={src}
          alt={alt}
          onClose={() => {
            setOpen(false);
            // Back to the picture that was tapped. Without this the caret lands on
            // `<body>` and the next Tab starts the page again from the top.
            trigger.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The screen-sized layer.
 *
 * Fitted, the picture *is* the dismiss target — tap anywhere, which is what every
 * photo view on a phone does. At actual size it is a pan surface instead and the way
 * out is the toolbar or Escape, because a tap that both scrolls and closes is a
 * picture you cannot look at. Tab is trapped for the same reason the story viewer
 * traps it: the page underneath is still there and still focusable.
 */
function Overlay({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    shell.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = shell.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href]",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt.trim() || "Photo"}
      className="fixed inset-0 z-50 bg-black/95"
    >
      <div ref={shell} tabIndex={-1} className="flex h-full w-full flex-col outline-none">
        <div className="flex justify-end gap-1.5 px-3 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => setZoom((z) => !z)}
            aria-pressed={zoom}
            aria-label={zoom ? "Fit to screen" : "Actual size"}
            className={`flex h-9 w-9 items-center justify-center rounded-pill transition-colors ${
              zoom ? "bg-panel-3 text-ink" : "bg-panel/80 text-muted hover:text-ink"
            }`}
          >
            <ExpandIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo"
            className="flex h-9 w-9 items-center justify-center rounded-pill bg-panel/80 text-muted transition-colors hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/*
          The picture sits directly inside whichever box it is in, rather than in a
          wrapper: `max-h-full` only resolves against a parent whose height is
          definite, and one auto-height div in between silently turns it into no
          limit at all — a tall screenshot running off the bottom of the screen.
        */}
        {zoom ? (
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} decoding="async" className="mx-auto max-w-none" />
          </div>
        ) : (
          // Not a button, deliberately: the ✕ above and Escape already carry this
          // action, and a second focus stop with the same name is a Tab that appears
          // to do nothing twice.
          <div
            onClick={onClose}
            className="flex min-h-0 flex-1 items-center justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
