"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CameraIcon, PlusIcon } from "../icons";
import { supportsFilters } from "../photo-filters";

/**
 * The two ways into the camera: a button in the top bar, and a `+` in the phone's tab
 * bar. One component for both — they open exactly the same thing, and there is no state
 * to share between them, so whichever was pressed owns the sheet until it closes.
 *
 * The sheet is loaded on press. It carries a viewfinder, a recorder and the filter
 * engine, none of which belongs in the first load of a page that may never open it.
 * `ssr: false` only works inside a Client Component, which this is, and `dynamic()` has
 * to sit at module scope — `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`.
 *
 * Both buttons live inside `glass-bar` elements, which is why the sheet portals out to
 * `document.body` rather than rendering here.
 */
const CameraSheet = dynamic(() => import("./camera-sheet").then((mod) => mod.CameraSheet), {
  ssr: false,
});

/** `bar` is an icon button in the top bar; `tab` is one item of the phone's tab bar. */
export function CameraButton({ variant }: { variant: "bar" | "tab" }) {
  const [open, setOpen] = useState<{ filters: boolean } | null>(null);

  return (
    <>
      <button
        type="button"
        // Probed in the press and handed over as a prop. It reads `document`, so it
        // cannot run in a server render, and probing it in an effect would be `setState`
        // in an effect — which this project's React Compiler rules reject. The press is
        // both the first moment the answer matters and unambiguously a moment on the
        // client. Same reasoning as the photo button in `components/messages/thread.tsx`.
        onClick={() => setOpen({ filters: supportsFilters() })}
        aria-label={variant === "bar" ? "Camera" : undefined}
        className={
          variant === "bar"
            ? "flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink"
            : "flex flex-1 flex-col items-center justify-center gap-1 rounded-card text-[11px] text-muted"
        }
      >
        {variant === "bar" ? (
          <CameraIcon className="h-4 w-4" />
        ) : (
          <>
            <PlusIcon className="h-5 w-5" />
            Camera
          </>
        )}
      </button>

      {open ? <CameraSheet filters={open.filters} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
