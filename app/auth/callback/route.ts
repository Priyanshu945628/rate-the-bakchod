import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth landing point. Google sends the user back here with a PKCE code, which
 * we exchange for a session; @supabase/ssr writes the cookies on the way out.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only relative paths, or an attacker could use ?next= to bounce a
  // freshly-authenticated user to their own site.
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Behind a load balancer the origin in request.url is the internal host.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";

      if (!isLocal && forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // The two ways this fails need different fixes, so tell /auth/error which one
  // it was. No provider message is forwarded — the reason is one of two fixed
  // tokens, so nothing from the session can leak into a URL.
  return NextResponse.redirect(
    `${origin}/auth/error?reason=${code ? "exchange" : "no_code"}`,
  );
}
