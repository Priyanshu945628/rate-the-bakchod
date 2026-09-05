import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOT_BOUNDS } from "@/lib/ai/bot-config";
import { CLAIM_WINDOW_MS, TICK_INTERVAL_MS } from "@/lib/background-tick";

/**
 * The heartbeat, and the ways it goes quiet without anybody noticing.
 *
 * This is the test for a bug that was live: the timer driving the bot ran in development
 * only, on the assumption that a deployed instance had a cron provider pointed at
 * `/api/cron/bakchod`. Nothing was pointed at it, so the only tick a deployed bot ever
 * got was an admin pressing a button — underneath a panel showing a perfectly healthy
 * saved cadence. Every check below is a way back into that state, and not one of them
 * looks like a mistake in a diff.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("the heartbeat", () => {
  it("runs everywhere, not just in development", () => {
    const source = read("instrumentation-node.ts");
    expect(source).toContain("setInterval");
    // The environment gate *was* the bug, so the check is that the name is absent from
    // the file altogether rather than that one particular shape of `if` is.
    expect(source).not.toContain("NODE_ENV");
  });

  it("fires more often than the fastest cadence the panel allows", () => {
    // A tick is when the bot notices it is due to post. A heartbeat slower than
    // `postIntervalMinutes` would quietly become the real interval, so the floor on that
    // knob is the ceiling on this one.
    expect(TICK_INTERVAL_MS).toBeLessThan(BOT_BOUNDS.postIntervalMinutes.min * 60_000);
  });
});

describe("the claim", () => {
  it("expires before the next heartbeat", () => {
    // At exactly the interval, a few milliseconds of timer drift leave `lastTickAt` a
    // hair too young, the claim fails, and the pass three minutes later is the one that
    // runs — halving the cadence on a system that looks like it is working.
    expect(CLAIM_WINDOW_MS).toBeLessThan(TICK_INTERVAL_MS);
  });

  it("still covers most of the interval, so two containers cannot both take it", () => {
    // The window is also the exclusion zone. Drop it far below the interval and both
    // containers claim inside the same nominal tick, which is what it exists to stop.
    expect(CLAIM_WINDOW_MS).toBeGreaterThan(TICK_INTERVAL_MS / 2);
  });

  it("locks on a nullable column, because 'never ticked' is a real state", () => {
    // The claim's other branch depends on it: a null means no tick has ever been taken,
    // which is both a free claim and what the panel reports.
    const model = /model BotSetting \{([\s\S]*?)\n\}/.exec(read("prisma/schema.prisma"))?.[1];
    expect(model).toBeTruthy();
    expect(model).toMatch(/\n\s*lastTickAt\s+DateTime\?/);
  });
});

/**
 * The heartbeat and the cron route ran the same four calls in two places, and their
 * result shapes had already begun to diverge. Both go through `runBackgroundTick` now,
 * so naming a step directly in either file is that drift coming back.
 *
 * `POST /api/admin/bot` is deliberately not in this list. The button calls
 * `runBakchodTick` itself so a bad key throws instead of being folded into a result
 * field — with every credential on that page write-only, an exception is the only way to
 * find out whether a saved key works.
 */
describe("the two background entry points", () => {
  const STEPS = ["drainOnce", "runBakchodTick", "pruneRateLimits"];

  for (const file of ["app/api/cron/bakchod/route.ts", "instrumentation-node.ts"]) {
    it(`${file} calls the shared tick and no step of it`, () => {
      const source = read(file);
      expect(source).toContain("runBackgroundTick");
      for (const step of STEPS) expect(source, step).not.toContain(step);
    });
  }
});
