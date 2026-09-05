import { NextResponse } from "next/server";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { MasterKeyError } from "@/lib/crypto";
import { EndpointCreateSchema } from "@/lib/ai/bot-config";
import { createEndpoint, listEndpointStatus } from "@/lib/ai/endpoints";

export const runtime = "nodejs";

/**
 * Add a gateway to the bot's fallback chain.
 *
 * Answers with the whole chain rather than the new row, because the whole chain is what
 * the panel draws and its order is the thing that changed. Value-free, like everything
 * on `/api/admin/bot`: labels, booleans and health, never a key, a base URL or a model.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const parsed = EndpointCreateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "That will not do.", 400);
    }

    await createEndpoint(parsed.data);
    return NextResponse.json(await listEndpointStatus());
  } catch (err) {
    if (err instanceof MasterKeyError) {
      // The full message names a shell command; an admin needs the fact, not a
      // tutorial in a toast.
      return jsonError("MEDIA_MASTER_KEY is not configured, so a key cannot be stored.", 500);
    }
    return handleRouteError(err);
  }
}
