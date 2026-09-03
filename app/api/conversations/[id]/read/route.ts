import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { markThreadRead } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark the thread read. Returns both badge counts.
 *
 * Not rate-limited, for the same reason the bell's mark-read is not: opening a
 * thread is what triggers this, and a refused read leaves a dot that will not clear.
 * The write is idempotent and touches only the caller's own membership row.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const counts = await markThreadRead(user.id, id);
    return NextResponse.json(counts, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
