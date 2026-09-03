"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "../config";

/**
 * Browser-side Supabase client. `createBrowserClient` is already a singleton,
 * so calling this per component is fine and intentional.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
  );
}
