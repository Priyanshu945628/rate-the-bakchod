import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "../config";

/**
 * Per-request Supabase client for Server Components, Server Actions and Route
 * Handlers. Never cache or share this across requests — it is bound to one
 * request's cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. That is expected — the
            // proxy refreshes the session on every request, so nothing is lost.
          }
        },
      },
    },
  );
}
