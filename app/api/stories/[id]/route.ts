import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError } from "@/lib/api";
import { deleteStory, markStorySeen } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a story seen. Idempotent — a re-view is not a new view, so the author's
 * count stays honest, and the author's own views are not recorded at all.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeWrite("storyView");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    await markStorySeen(auth.user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Delete your own story. This is the crypto-shred: Internet Archive has no delete,
 * so destroying the wrapped key *is* the deletion — the archived ciphertext can
 * never be read again.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeWrite("story");
  if ("response" in auth) return auth.response;

  try {
    const { id } = await params;
    await deleteStory(auth.user, id);
    return NextResponse.json({ ok: true, shredded: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
