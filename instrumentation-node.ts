/**
 * Node-runtime startup work. Imported by `instrumentation.ts` for its side
 * effects, so everything here runs exactly once when the server boots.
 */

import { recoverStuckUploads, kickWorker } from "./worker/archive-uploader";

const DEV_TICK_MS = 3 * 60_000;

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

  if (process.env.NODE_ENV !== "production") {
    // No cron provider locally, so drive the bot from a timer. Production uses
    // POST /api/cron/bakchod instead.
    const { runBakchodTick } = await import("./lib/ai/bakchod");
    const tick = async () => {
      try {
        await runBakchodTick();
      } catch (err) {
        console.warn("[dev bakchod tick]", err);
      }
    };
    const timer = setInterval(tick, DEV_TICK_MS);
    // Do not hold the event loop open on shutdown.
    timer.unref?.();
    void tick();
  }
}

void boot();
