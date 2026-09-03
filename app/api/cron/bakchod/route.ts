import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/config";
import { runBakchodTick } from "@/lib/ai/bakchod";
import { pruneRateLimits } from "@/lib/ratelimit";
import { drainOnce, recoverStuckUploads } from "@/worker/archive-uploader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vision plus a video transcode can outlast the default budget.
export const maxDuration = 300;

/**
 * Background tick: bot activity, archive uploads, housekeeping.
 *
 * Called by a scheduler (Vercel Cron, GitHub Actions, or the dev heartbeat in
 * instrumentation.ts). Guarded by a bearer token compared in constant time.
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

  const results: Record<string, unknown> = {};

  // Each step is independent — one failing must not skip the others.
  try {
    results.recovered = await recoverStuckUploads();
  } catch (err) {
    results.recoveredError = String(err);
  }

  try {
    results.archive = await drainOnce();
  } catch (err) {
    results.archiveError = String(err);
  }

  try {
    results.bot = await runBakchodTick();
  } catch (err) {
    results.botError = String(err);
  }

  try {
    results.prunedRateLimits = await pruneRateLimits();
  } catch (err) {
    results.pruneError = String(err);
  }

  return NextResponse.json(results);
}

// Most cron providers issue GETs.
export { POST as GET };
