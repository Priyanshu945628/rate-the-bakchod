import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { authorizeWrite, handleRouteError, readJsonBody } from "@/lib/api";
import { fetchOwnerTheme, saveTheme } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your own theme settings.
 *
 * There is no `[handle]` variant of this route on purpose: the only reader of the
 * full settings object is its owner. What a visitor needs is already folded into
 * the profile payload by `toClientTheme`, minus the welcome HTML and the privacy
 * flags.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const theme = await fetchOwnerTheme(user.id);
    return NextResponse.json({ theme }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Patch the profile — theme fields and identity in one body. An absent key means
 * "leave it alone", an explicit `null` means "clear it", so the settings page can
 * save one section at a time without the others being wiped.
 *
 * `identity` comes back because a handle change moves the page you are on: the
 * client needs the new one to `router.replace` rather than sit on a URL that is
 * now a redirect stub.
 */
export async function PATCH(request: Request) {
  const auth = await authorizeWrite("profile");
  if ("response" in auth) return auth.response;

  try {
    const body = await readJsonBody(request);
    const { theme, identity } = await saveTheme(auth.user, body);
    return NextResponse.json(
      { theme, identity },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
