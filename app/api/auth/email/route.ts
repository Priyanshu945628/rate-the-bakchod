import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/config";
import { publicEnv } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin-only email sign-in.
 *
 * Only the email+password pair stored in `ADMIN_EMAIL` / `ADMIN_PASSWORD` is
 * accepted. Every other combination gets a flat refusal.
 *
 * Uses the service role key to create the Supabase identity (bypasses rate
 * limits and email confirmation), then the per-request client to sign in so
 * the session cookie lands on the response.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const email =
    typeof (body as Record<string, unknown>).email === "string"
      ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
      : "";
  const password =
    typeof (body as Record<string, unknown>).password === "string"
      ? ((body as Record<string, unknown>).password as string)
      : "";

  const adminEmail = serverEnv.adminEmail?.toLowerCase();
  const adminPassword = serverEnv.adminPassword;

  if (
    !adminEmail ||
    !adminPassword ||
    email !== adminEmail ||
    password !== adminPassword
  ) {
    return NextResponse.json(
      { error: "Administrator has blocked email sign-in" },
      { status: 403 },
    );
  }

  const serviceKey = serverEnv.supabaseServiceRoleKey;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Email sign-in is not configured." },
      { status: 500 },
    );
  }

  // Admin client — bypasses rate limits and email confirmation.
  const admin = createAdminClient(publicEnv.supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Ensure the identity exists. createUser is idempotent-ish: if the email
  // already has an account it errors, which we ignore and move on to sign-in.
  await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  // Sign in through the per-request SSR client so the session cookie is set.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return NextResponse.json(
      { error: signInError.message },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
