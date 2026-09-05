import { NextResponse } from "next/server";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { EndpointMoveSchema, EndpointPatchSchema } from "@/lib/ai/bot-config";
import {
  deleteEndpoint,
  listEndpointStatus,
  moveEndpoint,
  updateEndpoint,
} from "@/lib/ai/endpoints";

export const runtime = "nodejs";

/**
 * Rename, reorder, switch off or remove one gateway in the bot's fallback chain.
 *
 * Both methods answer with the whole chain, in order — the panel has no use for a single
 * row, and after a reorder the row that changed is not the row that was pressed.
 *
 * `{ move }` is its own body rather than a field of the patch: it is a swap with the
 * neighbour, so there is nothing on this row for it to set. Nothing on this route writes
 * a credential; replacing a key is a DELETE and a POST.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const { id } = await params;
    const body = await readJsonBody(request);
    const moving = typeof body === "object" && body !== null && "move" in body;

    if (moving) {
      const parsed = EndpointMoveSchema.safeParse(body);
      if (!parsed.success) return jsonError("Up or down.", 400);
      if (!(await moveEndpoint(id, parsed.data.move))) {
        return jsonError("That one is already gone.", 404);
      }
    } else {
      const parsed = EndpointPatchSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(parsed.error.issues[0]?.message ?? "That will not do.", 400);
      }
      if (!(await updateEndpoint(id, parsed.data))) {
        return jsonError("That one is already gone.", 404);
      }
    }

    return NextResponse.json(await listEndpointStatus());
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const { id } = await params;
    // Not an error worth a toast if it is already gone: the list that comes back is the
    // answer either way, and it is the list the admin was looking at being wrong.
    await deleteEndpoint(id);

    return NextResponse.json(await listEndpointStatus());
  } catch (err) {
    return handleRouteError(err);
  }
}
