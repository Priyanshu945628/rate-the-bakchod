import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { MasterKeyError } from "@/lib/crypto";
import { BotCredentialsSchema, BotTuningSchema } from "@/lib/ai/bot-config";
import {
  readBotStatus,
  saveBotCredentials,
  saveBotTuning,
} from "@/lib/ai/settings";
import { runBakchodTick } from "@/lib/ai/bakchod";

export const runtime = "nodejs";
// `runTick` does everything the cron does: vision on up to three posts, a card
// render, a transcode. Same budget as the cron route for the same reason.
export const maxDuration = 300;

/**
 * The bot's control surface.
 *
 * `PATCH` writes cadence, credentials, or both, and answers with the status — which
 * for the three credentials is only where each one is coming from. Nothing on this
 * route ever returns a key, a base URL or a model id, not even truncated, so the
 * response is safe to leave open in a devtools tab.
 *
 * `POST {action: "runTick"}` is the other half of that: with no value on the page to
 * read back, the way to know a saved key works is to make the bot use it and see
 * whether anything came out.
 */
const PatchSchema = z.object({
  tuning: BotTuningSchema.optional(),
  credentials: BotCredentialsSchema.optional(),
});

export async function PATCH(request: Request) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const parsed = PatchSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "That will not do.", 400);
    }

    const { tuning, credentials } = parsed.data;
    if (tuning) await saveBotTuning(tuning);
    if (credentials) await saveBotCredentials(credentials);

    return NextResponse.json(await readBotStatus());
  } catch (err) {
    if (err instanceof MasterKeyError) {
      // The full message names a shell command; an admin needs the fact, not a
      // tutorial in a toast.
      return jsonError("MEDIA_MASTER_KEY is not configured, so a key cannot be stored.", 500);
    }
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const body = (await readJsonBody(request)) as { action?: unknown };
    if (body.action !== "runTick") return jsonError("Unknown action.", 400);

    // Deliberately not caught: a tick that throws is a broken gateway or a bad key,
    // and that is exactly what the button was pressed to find out. Every ordinary
    // failure inside the tick already degrades to a canned line on its own.
    const result = await runBakchodTick();
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
