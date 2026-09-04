import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { deleteMessage, editMessage, fetchThread, sendMessage } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One page of a thread, oldest entry first.
 *
 * A thread the caller is not in is a 404, not a 403 — the same answer as a thread
 * that does not exist, because telling a stranger which conversation ids are real is
 * itself a leak.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Sign in first.", 401);

    const { id } = await params;
    const cursor = new URL(request.url).searchParams.get("cursor");
    const thread = await fetchThread(user.id, id, cursor);
    if (!thread) return jsonError("No such conversation.", 404);

    return NextResponse.json(thread, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Send. `{ body }`, `{ attachmentKey }`, or both, and optionally `{ replyToId }`. */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authorizeWrite("message");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    const raw = (await readJsonBody(request)) as {
      body?: unknown;
      attachmentKey?: unknown;
      replyToId?: unknown;
    };
    if (raw.body !== undefined && raw.body !== null && typeof raw.body !== "string") {
      return jsonError("`body` must be a string.", 400);
    }
    if (
      raw.attachmentKey !== undefined &&
      raw.attachmentKey !== null &&
      typeof raw.attachmentKey !== "string"
    ) {
      return jsonError("`attachmentKey` must be a string.", 400);
    }
    if (
      raw.replyToId !== undefined &&
      raw.replyToId !== null &&
      typeof raw.replyToId !== "string"
    ) {
      return jsonError("`replyToId` must be a string.", 400);
    }

    const message = await sendMessage(auth.user, {
      conversationId: id,
      body: typeof raw.body === "string" ? raw.body : null,
      attachmentKey: typeof raw.attachmentKey === "string" ? raw.attachmentKey : null,
      // Checked against *this* conversation in `sendMessage`, not here — a reply id
      // from another thread is a leak, not a validation error.
      replyToId: typeof raw.replyToId === "string" ? raw.replyToId : null,
    });
    return NextResponse.json({ message }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Rewrite one of your own messages. `{ id, body }`.
 *
 * Same shape as DELETE below, and for the same reason: the path's conversation id is
 * not consulted, because ownership of the message is the only thing that decides it
 * and `editMessage` puts `senderId` in the `where`.
 */
export async function PATCH(request: Request) {
  const auth = await authorizeWrite("message");
  if ("response" in auth) return auth.response;

  try {
    const raw = (await readJsonBody(request)) as { id?: unknown; body?: unknown };
    if (typeof raw.id !== "string") return jsonError("Which message?", 400);
    if (typeof raw.body !== "string") return jsonError("`body` must be a string.", 400);

    const message = await editMessage(auth.user, raw.id, raw.body);
    return NextResponse.json({ message }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Delete one of your own messages. `{ id }` in the body.
 *
 * The conversation id in the path is not consulted: ownership of the message is the
 * only thing that decides this, and `deleteMessage` puts `senderId` in the `where`.
 */
export async function DELETE(request: Request) {
  const auth = await authorizeWrite("message");
  if ("response" in auth) return auth.response;

  try {
    const body = (await readJsonBody(request)) as { id?: unknown };
    if (typeof body.id !== "string") return jsonError("Which message?", 400);

    await deleteMessage(auth.user, body.id);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
