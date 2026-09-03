import { NextResponse } from "next/server";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { fetchNotifications, markRead } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A page of the bell, newest first. Cursor-paginated the same way the feed is. */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Sign in first.", 401);

    const url = new URL(request.url);
    const page = await fetchNotifications(user.id, url.searchParams.get("cursor"));

    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Mark read. `{ id }` for one row, nothing for all of them.
 *
 * Not behind `authorizeWrite`: opening the bell marks it read, and rate-limiting
 * that would mean a badge that will not clear. The write is idempotent and touches
 * only the caller's own rows, so there is nothing here worth spending a bucket on.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJsonBody(request);
    const { id } = (body ?? {}) as Record<string, unknown>;
    if (id !== undefined && typeof id !== "string") {
      return jsonError("`id` must be a string.", 400);
    }

    const unread = await markRead(user.id, id ?? null);
    return NextResponse.json({ unread }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
