import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/config";
import { runBackgroundTick } from "@/lib/background-tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vision plus a video transcode can outlast the default budget.
export const maxDuration = 300;

/**
 * Background tick over HTTP, for an external scheduler.
 *
 * The work itself is `runBackgroundTick` — the same function the in-process heartbeat in
 * `instrumentation-node.ts` calls, so the two cannot drift. That heartbeat means this
 * route is no longer what keeps the bot alive; it is here so a real cron provider can
 * drive the tick if one is ever pointed at it.
 *
 * Claimed like the heartbeat, which is the point: with both wired up, whichever arrives
 * second inside the same window does nothing instead of posting a second time.
 *
 * Guarded by a bearer token compared in constant time.
 */
async function authorize(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return false;

  try {
    return safeEqual(token, serverEnv.cronSecret);
  } catch {
    // CRON_SECRET is not configured; refuse rather than run unauthenticated.
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Nope." }, { status: 401 });
  }

  return NextResponse.json(await runBackgroundTick({ claim: true }));
}

// Most cron providers issue GETs.
export { POST as GET };
