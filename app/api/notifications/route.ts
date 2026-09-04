import { NextResponse } from "next/server";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { unreadConversationCount } from "@/lib/messages";
import { fetchNotifications, markRead } from "@/lib/notifications";
import { publish } from "@/lib/realtime";

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
 * Not behind `authorizeWrite`: opening the panel marks it read, and rate-limiting that
 * would mean a badge that will not clear. The write is idempotent and touches only the
 * caller's own rows, so there is nothing here worth spending a bucket on.
 *
 * The new total is published as well as returned. The caller gets it for free, but the
 * bell that needs it is in the top bar of a *different* tree — a page navigation does
 * not remount it — and the same account may be open in three other tabs. One event
 * settles all of them.
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
    // The event carries both counts, so the conversation total has to be fetched even
    // though nothing about it changed — sending a stale one would clear the rail's dot.
    publish(user.id, {
      type: "unread",
      notifications: unread,
      conversations: await unreadConversationCount(user.id),
    });

    return NextResponse.json({ unread }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
