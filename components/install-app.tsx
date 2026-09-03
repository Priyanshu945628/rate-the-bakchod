"use client";

import { useEffect, useState } from "react";
import { InstallIcon } from "./icons";

/**
 * Two jobs, both of them the browser's side of being installable.
 *
 * It registers the service worker (`public/sw.js`), and it offers the install
 * button — but only when the browser has said the site qualifies, by firing
 * `beforeinstallprompt`. That event is Chromium-only, so on Safari and Firefox
 * this renders nothing at all rather than a button that explains how to install
 * by hand: the platform already has "Add to Home Screen" in its own share sheet,
 * and a panel teaching people where to find it is exactly the kind of prose this
 * app does not put on screen.
 *
 * It also renders nothing once installed — `appinstalled` clears it, and a launch
 * from the home screen never gets the event in the first place.
 *
 * ## Why the worker is production-only
 *
 * In development `/_next/static/*` is not content-hashed; it is rewritten in place
 * on every edit. The worker serves that prefix cache-first, so registering it
 * against a dev server would answer hot updates from a stale cache and the page
 * would stop reflecting the file being edited.
 */

/** `beforeinstallprompt` is not in lib.dom — Chromium-only, never standardised. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallApp() {
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // A failed registration is a site without an offline fallback, not a broken
    // one; there is nothing to tell anybody about it.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    const onOffer = (event: Event) => {
      // Chromium shows its own mini-infobar unless this is prevented. Taking the
      // event means the app decides where the button lives.
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
    };
    const onInstalled = () => setOffer(null);

    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!offer) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // Cleared first, not after: the event is single-use, and a second click
        // while the native dialog is up throws.
        setOffer(null);
        void offer.prompt();
      }}
      title="Install app"
      aria-label="Install app"
      className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink"
    >
      <InstallIcon className="h-4 w-4" />
    </button>
  );
}
