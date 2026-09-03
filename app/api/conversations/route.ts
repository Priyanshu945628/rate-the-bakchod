import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { fetchConversations, openConversation } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every thread the caller is in, newest activity first, with the unread total. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Sign in first.", 401);

    const list = await fetchConversations(user.id);
    return NextResponse.json(list, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Open the thread with `{ handle }`, creating it if this is the first time.
 *
 * Idempotent, so the "Message" button on a profile is a POST that can be pressed
 * twice without making two threads — `pairKey` is unique and `openConversation`
 * catches the race.
 *
 * On the `message` bucket rather than a bucket of its own: opening a thread is the
 * cheap half of sending one, and a separate allowance would just be a second way to
 * spend the same attention.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("message");
  if ("response" in auth) return auth.response;

  try {
    const body = (await readJsonBody(request)) as { handle?: unknown };
    if (typeof body.handle !== "string" || body.handle.trim().length === 0) {
      return jsonError("Which person?", 400);
    }

    const conversation = await openConversation(auth.user, body.handle.trim().toLowerCase());
    return NextResponse.json(conversation, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
