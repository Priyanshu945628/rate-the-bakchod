import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin-only email sign-in.
 *
 * Only the email+password pair stored in `ADMIN_EMAIL` / `ADMIN_PASSWORD` is
 * accepted. Every other combination gets a flat refusal with no hint about
 * what went wrong — the existence of this route is not a door to open.
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

  const supabase = await createClient();

  // Try signing in — the account may already exist from a previous session.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (!signInError) return new NextResponse(null, { status: 204 });

  // First time: create the Supabase identity, then sign in with it.
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError) {
    return NextResponse.json(
      { error: signUpError.message },
      { status: 500 },
    );
  }

  // When email confirmation is off, signUp returns a session directly.
  if (signUpData.session) return new NextResponse(null, { status: 204 });

  // Otherwise try signIn — some configurations auto-confirm.
  const { error: retryError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (retryError) {
    return NextResponse.json(
      { error: "Account created but not confirmed. Disable email confirmation in Supabase Auth settings." },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
