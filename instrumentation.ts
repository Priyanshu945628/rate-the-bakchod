/**
 * Server startup hook. Next calls `register()` once per server instance.
 *
 * Two things need to happen here rather than on first request: uploads that were
 * mid-flight when the process died have to be requeued, and in development
 * there is no cron provider, so the bot needs a local heartbeat.
 */
export async function register() {
  // `next build` also evaluates this file while prerendering. Nothing here
  // should touch the database during a build.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await import("./instrumentation-node");
}
