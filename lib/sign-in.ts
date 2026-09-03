"use client";

import { createClient } from "./supabase/client";

/**
 * Start Google OAuth. Returns an error message, or null when the browser is
 * already on its way to Google.
 *
 * `next` is where `/auth/callback` lands the user afterwards. An `/auth` path is
 * never a valid destination — that is the callback or the error page, and coming
 * back to either after a *successful* sign-in would just look like a failure.
 * The callback re-checks this server-side; this only picks a sane default.
 */
export async function startGoogleSignIn(next?: string | null): Promise<string | null> {
  const safe =
    next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth")
      ? next
      : "/";

  const { error } = await createClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safe)}`,
    },
  });

  return error ? error.message : null;
}
