"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { startGoogleSignIn } from "@/lib/sign-in";
import { SpinnerIcon } from "./icons";

/**
 * Stands where a write control would be for a signed-out visitor.
 *
 * Every write endpoint already refuses an anonymous request, so these prompts are
 * not the enforcement — they are the affordance. Each one can start the sign-in
 * itself and come back to the same page, rather than sending the reader off to
 * hunt for the button in the top bar.
 */
export function SignInPrompt({
  children,
  size = "sm",
  className = "",
}: {
  children: React.ReactNode;
  size?: "sm" | "xs";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  async function start() {
    setBusy(true);
    setError(null);
    const message = await startGoogleSignIn(pathname);
    // On success the browser is already navigating away, so only a failure needs
    // the button back.
    if (message) {
      setError(message);
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <p className={size === "xs" ? "text-xs text-faint" : "text-sm text-muted"}>
        {children}
      </p>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="flex h-8 shrink-0 items-center gap-2 rounded-ctl bg-accent px-3 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
        Sign in with Google
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
