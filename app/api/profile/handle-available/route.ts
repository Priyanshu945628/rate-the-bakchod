import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError } from "@/lib/api";
import { handleAvailable } from "@/lib/identity";
import { HandleSchema } from "@/lib/profile-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is this @handle free for me to take?
 *
 * A GET that spends from the `profile` bucket, which reads oddly until you notice
 * it is a lookup against every account in the table: unmetered, it would be a
 * handle-enumeration endpoint. The answer is also deliberately thin — `true` or
 * `false` and the reason we would show anyway, never "taken by @someone".
 */
export async function GET(request: Request) {
  const auth = await authorizeWrite("profile");
  if ("response" in auth) return auth.response;

  try {
    const raw = new URL(request.url).searchParams.get("handle") ?? "";
    const parsed = HandleSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "That handle will not do.", 400);
    }

    const available = await handleAvailable(parsed.data, auth.user.id);
    return NextResponse.json(
      { handle: parsed.data, available },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
