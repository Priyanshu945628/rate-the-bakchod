import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import {
  addStoryToHighlight,
  createHighlight,
  deleteHighlight,
  fetchHighlights,
  fetchStoryArchive,
  removeStoryFromHighlight,
  renameHighlight,
  setHighlightCover,
} from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(64);

/**
 * One endpoint, one discriminated union — the same shape `/api/admin` uses. The
 * alternative was seven routes for seven one-line operations, all with identical
 * auth and all owner-scoped in exactly the same way.
 */
const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string() }),
  z.object({ action: z.literal("rename"), id, title: z.string() }),
  z.object({ action: z.literal("delete"), id }),
  z.object({ action: z.literal("setCover"), id, assetKey: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ action: z.literal("add"), id, postId: id }),
  z.object({ action: z.literal("remove"), postId: id }),
]);

/**
 * Your highlights plus your story archive — expired stories included, which is the
 * counterpart to expiry being non-destructive. Owner-only: this is the settings
 * view, not the public highlight row.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const [highlights, archive] = await Promise.all([
      fetchHighlights(user.id),
      fetchStoryArchive(user.id),
    ]);
    return NextResponse.json(
      { highlights, archive },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeWrite("story");
  if ("response" in auth) return auth.response;

  try {
    const parsed = ActionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Unknown action.", 400);
    }
    const body = parsed.data;
    const user = auth.user;

    switch (body.action) {
      case "create": {
        const highlight = await createHighlight(user, body.title);
        return NextResponse.json({ highlight }, { status: 201 });
      }
      case "rename":
        await renameHighlight(user, body.id, body.title);
        break;
      case "delete":
        await deleteHighlight(user, body.id);
        break;
      case "setCover":
        await setHighlightCover(user, body.id, body.assetKey);
        break;
      case "add":
        await addStoryToHighlight(user, body.postId, body.id);
        break;
      case "remove":
        await removeStoryFromHighlight(user, body.postId);
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
