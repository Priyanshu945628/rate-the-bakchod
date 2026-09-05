/**
 * Node-runtime startup work. Imported by `instrumentation.ts` for its side
 * effects, so everything here runs exactly once when the server boots.
 */

import { recoverStuckUploads, kickWorker } from "./worker/archive-uploader";

/**
 * How long the server gets to itself before the first tick.
 *
 * A tick can mean vision calls, a card render and a transcode; starting one while the
 * container is still cold puts that in front of whoever loaded the page that woke it.
 */
const WARMUP_MS = 20_000;

async function boot() {
  // Anything left in UPLOADING when the process died is not coming back on its
  // own — the in-memory queue went with it. Put those rows back to PENDING and
  // let the worker pick them up.
  try {
    const recovered = await recoverStuckUploads();
    if (recovered > 0) {
      console.log(`[startup] requeued ${recovered} interrupted upload(s)`);
    }
    kickWorker();
  } catch (err) {
    // A cold start with no database configured must not take the server down.
    console.warn("[startup] upload recovery skipped:", err);
  }

  // The heartbeat, in production as well as locally.
  //
  // It used to run in development only, on the assumption that a deployed instance had a
  // cron provider pointed at `/api/cron/bakchod`. Railway has no cron, and nothing else
  // was calling it, so the only tick in production was an admin pressing "Run tick now" —
  // the bot sat there between button presses no matter what its post interval said. Each
  // pass claims itself against `BotSetting.lastTickAt` (see `lib/background-tick.ts`), so
  // a second container cannot double-post.
  //
  // Imported here rather than at the top so the bot, the SDK and the archive worker are
  // not pulled into the module graph until the first tick is actually due.
  const { runBackgroundTick, TICK_INTERVAL_MS } = await import("./lib/background-tick");
  const tick = async () => {
    try {
      await runBackgroundTick({ claim: true });
    } catch (err) {
      // `runBackgroundTick` catches each step itself, so reaching this is the claim or
      // the import failing — worth a line, not worth a crash.
      console.warn("[tick] heartbeat failed:", err);
    }
  };

  const timer = setInterval(tick, TICK_INTERVAL_MS);
  const warmup = setTimeout(tick, WARMUP_MS);
  // Do not hold the event loop open on shutdown.
  timer.unref?.();
  warmup.unref?.();
}

void boot();
