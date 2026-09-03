"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startGoogleSignIn } from "@/lib/sign-in";
import type { ClientViewer } from "@/lib/types";
import { Avatar } from "./avatar";
import { SpinnerIcon } from "./icons";

/**
 * Sign in / sign out.
 *
 * OAuth returns to `/auth/callback`, which exchanges the code and then bounces
 * back to whichever page the user started on.
 */
export function AuthButton({ viewer }: { viewer: ClientViewer | null }) {
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function signIn() {
    setBusy(true);
    const message = await startGoogleSignIn(pathname);
    // On success the browser is already navigating away, so only a failure
    // needs the button back.
    if (message) {
      setBusy(false);
      alert(message);
    }
  }

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.refresh();
    setBusy(false);
  }

  if (!viewer) {
    return (
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="flex h-10 items-center gap-2 rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/u/${encodeURIComponent(viewer.handle)}`}
        className="flex items-center gap-3 rounded-ctl transition-opacity hover:opacity-80"
      >
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium text-ink">{viewer.displayName}</div>
          <div className="text-xs text-faint">@{viewer.handle}</div>
        </div>
        <Avatar src={viewer.avatarUrl} name={viewer.displayName} size={36} />
      </Link>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="h-9 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
