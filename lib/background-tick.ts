import "server-only";

/**
 * The one background pass, and the claim that stops two of them overlapping.
 *
 * Four independent steps — requeue interrupted uploads, drain the archive queue, run
 * the bot, prune rate limits — with two entry points: the heartbeat in
 * `instrumentation-node.ts` and `POST /api/cron/bakchod`. They used to be two copies of
 * the same four calls, which is how one of them ends up a step behind the other.
 *
 * ## Why the heartbeat is in the process
 *
 * It was previously gated behind `NODE_ENV !== "production"`, on the assumption that
 * production had a cron provider pointed at the route. Railway does not, and nothing
 * else does either, so in production the *only* tick was an admin pressing "Run tick
 * now" — a bot with a 30-minute post interval that had never posted unattended. The
 * timer therefore runs everywhere, and the route stays as the way an external scheduler
 * can drive the same work if one is ever wired up.
 *
 * ## Why the lock is a column
 *
 * Two containers, or a container plus a real cron, would each run the whole thing on
 * their own clock and the bot would post twice. `BotSetting.lastTickAt` is the lock: one
 * conditional UPDATE, so the winner is whoever Postgres serialises first.
 *
 * Not a Postgres advisory lock, which is the usual answer. Supabase's pooler is
 * transaction-mode, so `pg_advisory_xact_lock` would hold a pooled connection open for
 * the tick's whole 300-second budget, and the session-scoped `pg_advisory_lock` would be
 * taken on a connection that then goes back to the pool still holding it.
 */

import { runBakchodTick, type TickResult } from "./ai/bakchod";
import { claimTick } from "./ai/settings";
import { pruneRateLimits } from "./ratelimit";
import { drainOnce, recoverStuckUploads } from "../worker/archive-uploader";

/**
 * How often the heartbeat fires.
 *
 * Well under the 5-minute floor on `postIntervalMinutes`, because the tick is when the
 * bot *notices* it is due: a heartbeat slower than the interval would quietly become
 * the real cadence. Each pass is a handful of indexed queries when there is nothing to
 * do.
 */
export const TICK_INTERVAL_MS = 3 * 60_000;

/**
 * How long a claim holds.
 *
 * Deliberately shorter than the interval. At exactly the interval, ordinary timer drift
 * of a few milliseconds would leave `lastTickAt` a hair too young, the claim would fail,
 * and the next attempt three minutes later would be the one that ran — halving the
 * cadence for no reason. Exported for the test that pins it under the interval.
 */
export const CLAIM_WINDOW_MS = Math.floor(TICK_INTERVAL_MS * 0.8);

export interface BackgroundTickResult {
  /** False when another runner held the claim; every other field is then absent. */
  ran: boolean;
  recovered?: number;
  recoveredError?: string;
  archive?: { uploaded: number; verified: number };
  archiveError?: string;
  bot?: TickResult;
  botError?: string;
  prunedRateLimits?: number;
  pruneError?: string;
}

/** The error fields above, for the one log line at the end. */
const ERROR_KEYS = ["recoveredError", "archiveError", "botError", "pruneError"] as const;

/**
 * Run the four steps once. Never throws: a caller on a timer has nowhere to put an
 * exception, and a caller on a cron wants the other three steps regardless.
 *
 * `claim: false` skips the lock, for a caller that is deliberately forcing a pass — the
 * admin panel's button, which is pressed precisely because nothing has happened.
 */
export async function runBackgroundTick(
  options: { claim?: boolean } = {},
): Promise<BackgroundTickResult> {
  if (options.claim && !(await claimTick(CLAIM_WINDOW_MS))) return { ran: false };

  const result: BackgroundTickResult = { ran: true };

  // Each step is independent — one failing must not skip the others. Uploads are
  // recovered before the drain so anything left UPLOADING by a killed container is
  // back in PENDING in time for this pass rather than the next one.
  try {
    result.recovered = await recoverStuckUploads();
  } catch (err) {
    result.recoveredError = String(err);
  }

  try {
    result.archive = await drainOnce();
  } catch (err) {
    result.archiveError = String(err);
  }

  try {
    result.bot = await runBakchodTick();
  } catch (err) {
    result.botError = String(err);
  }

  try {
    result.prunedRateLimits = await pruneRateLimits();
  } catch (err) {
    result.pruneError = String(err);
  }

  const failed = ERROR_KEYS.filter((key) => result[key] !== undefined);
  // One line naming the steps, not four stack traces: the heartbeat runs every three
  // minutes forever, and a step that is failing is failing on every one of them.
  if (failed.length > 0) console.warn(`[tick] ${failed.join(", ")}`);

  return result;
}
