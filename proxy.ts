import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh. ("Proxy" is what Next.js 16 calls what used to be
 * middleware — same mechanism, new file name.)
 *
 * Server Components cannot write cookies, so this is the only place a refreshed
 * auth token gets persisted. Two rules matter here and both are easy to break:
 *
 *  1. Nothing may run between creating the client and calling getClaims() — a
 *     stray await in between can leave the session in a half-refreshed state
 *     and cause random logouts.
 *  2. The `response` object built inside setAll must be the one returned. Any
 *     other NextResponse loses the refreshed cookies.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // These are no-cache headers. A CDN caching a Set-Cookie response
          // would hand one user's session to the next visitor.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // getClaims(), not getSession() — getSession does not revalidate the token
  // and must never be trusted in server code.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and /api/media. Media responses are
     * public, immutable and hot; refreshing a session on each one would add a
     * round trip to every image in the feed for no benefit.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/media|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|mp4|ico)$).*)",
  ],
};
