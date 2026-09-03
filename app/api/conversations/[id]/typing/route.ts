import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { notifyTyping } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "They're typing…" — relayed to the other side and stored nowhere.
 *
 * Always 202, whatever happened. The client throttles these to one every few
 * seconds and has nothing useful to do with a failure, and answering "you are not in
 * that conversation" here would turn a keystroke into an existence oracle.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await notifyTyping(user.id, id);
    return new NextResponse(null, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
