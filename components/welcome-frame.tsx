"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  WELCOME_MIN_HEIGHT,
  WELCOME_SANDBOX,
  clampWelcomeHeight,
} from "@/lib/welcome-doc";
import { PlayIcon, XIcon } from "./icons";

/**
 * A profile's welcome animation, in a frame that cannot reach the page around it.
 *
 * Everything here assumes the framed document is hostile, because it might be: it
 * is HTML somebody else wrote, and this component runs on a page where the visitor
 * is signed in. The document gets `sandbox="allow-scripts"` and no
 * `allow-same-origin`, which puts it on an opaque origin — no access to cookies,
 * storage, or `window.parent`. `postMessage` is the only channel left, and this
 * side treats every message as untrusted input.
 *
 * Three things live in the parent on purpose:
 *
 *   1. **The auto-dismiss timer.** A timer inside the frame is one the frame can
 *      decline to fire, which would leave a visitor stuck looking at somebody's
 *      intro. This one runs out here regardless of what the document does.
 *   2. **The Skip button.** Same reason: it must be reachable even if the document
 *      is a solid black rectangle that swallows every event.
 *   3. **The height clamp.** The frame asks; the parent decides.
 */

interface WelcomeFrameProps {
  /** `/api/welcome/[handle]`. */
  src: string;
  handle: string;
  displayName: string;
  /** 0 means "wait for the visitor" — the intro then only closes on Skip. */
  autoDismissMs: number;
}

/** One key per profile, so replaying one intro does not replay all of them. */
function sessionKey(handle: string) {
  return `rtb:welcome:${handle}`;
}

function readSeen(handle: string): boolean {
  try {
    return sessionStorage.getItem(sessionKey(handle)) === "1";
  } catch {
    // Private mode, or storage disabled. Erring towards playing is the kinder
    // failure: one extra intro beats a feature that silently never works.
    return false;
  }
}

function markSeen(handle: string) {
  try {
    sessionStorage.setItem(sessionKey(handle), "1");
  } catch {
    /* not worth telling anyone about */
  }
}

/**
 * Both of these are browser facts that do not exist during SSR, so they are read
 * through `useSyncExternalStore` with a server snapshot rather than assigned to
 * state in an effect. That is what keeps the first client render honest — the
 * server assumes "unseen, motion fine", and React re-renders once it can see the
 * real answer, with no hydration mismatch and no cascading effect.
 */
const NO_UPDATES = () => () => {};

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const readMotion = () => window.matchMedia(MOTION_QUERY).matches;
const serverFalse = () => false;

export function WelcomeFrame({
  src,
  handle,
  displayName,
  autoDismissMs,
}: WelcomeFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const seenBefore = useSyncExternalStore(
    NO_UPDATES,
    useCallback(() => readSeen(handle), [handle]),
    serverFalse,
  );
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, serverFalse);

  /** What the visitor has since decided, which overrides both facts above. */
  const [choice, setChoice] = useState<"play" | "dismiss" | null>(null);
  const [height, setHeight] = useState(WELCOME_MIN_HEIGHT);
  const [run, setRun] = useState(0);

  const phase =
    choice === "play"
      ? "playing"
      : choice === "dismiss" || seenBefore
        ? "gone"
        : reducedMotion
          ? "held"
          : "playing";

  const dismiss = useCallback(() => {
    markSeen(handle);
    setChoice("dismiss");
  }, [handle]);

  function play() {
    // A new key remounts the iframe, so a replay starts from the top instead of
    // showing whatever frame the animation happened to end on.
    setRun((n) => n + 1);
    setHeight(WELCOME_MIN_HEIGHT);
    setChoice("play");
  }

  // The frame speaks only to say "I'm done" or "I'd like to be this tall". Both are
  // checked against `contentWindow` first: any other sender is ignored, which is
  // what stops one frame on the page from closing another.
  useEffect(() => {
    if (phase !== "playing") return;

    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { __rtb?: unknown; px?: unknown } | null;
      if (!data || typeof data !== "object" || typeof data.__rtb !== "string") return;

      if (data.__rtb === "done") {
        dismiss();
      } else if (data.__rtb === "height" && typeof data.px === "number") {
        setHeight(clampWelcomeHeight(data.px));
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase, dismiss]);

  // The parent's clock. It runs out whatever the document does or does not do.
  useEffect(() => {
    if (phase !== "playing" || autoDismissMs <= 0) return;
    const timer = window.setTimeout(dismiss, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [phase, autoDismissMs, dismiss, run]);

  if (phase === "gone") {
    return (
      <button
        type="button"
        onClick={play}
        className="flex h-8 items-center gap-1.5 rounded-ctl border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <PlayIcon className="h-3.5 w-3.5" />
        Replay intro
      </button>
    );
  }

  if (phase === "held") {
    return (
      <button
        type="button"
        onClick={play}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-ctl border border-line bg-panel-2 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <PlayIcon className="h-4 w-4" />
        Play {displayName}&rsquo;s intro
      </button>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-ctl border border-line bg-black">
      <iframe
        key={run}
        ref={frameRef}
        src={src}
        title={`${displayName}'s intro`}
        // No `allow-same-origin`, and nothing else either. This attribute is what
        // makes the whole feature safe; the route repeats it in its CSP so that
        // deleting one of the two does not quietly undo it.
        sandbox={WELCOME_SANDBOX}
        referrerPolicy="no-referrer"
        scrolling="no"
        className="block w-full border-0"
        style={{ height }}
      />
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 flex h-8 items-center gap-1.5 rounded-pill bg-panel px-3 text-[11px] font-semibold text-ink transition-opacity hover:opacity-90"
      >
        <XIcon className="h-3.5 w-3.5" />
        Skip
      </button>
    </div>
  );
}
