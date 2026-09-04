import { NextResponse } from "next/server";
import { authorizeWrite, handleRouteError, jsonError, readJsonBody, readMultipart } from "@/lib/api";
import { limits } from "@/lib/config";
import { clearProfileAsset, putProfileAsset } from "@/lib/profile";
import type { ProfileAssetSlot } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLOTS = ["BANNER", "LOGO", "HIGHLIGHT_COVER"] as const;

function parseSlot(raw: unknown): ProfileAssetSlot | null {
  return typeof raw === "string" && (SLOTS as readonly string[]).includes(raw)
    ? (raw as ProfileAssetSlot)
    : null;
}

/**
 * Upload a banner, logo or highlight cover. Multipart: `slot` and `file`.
 *
 * The response carries the new key and URL. A key is minted per upload and never
 * reused, which is what lets `GET /api/profile-asset/[key]` answer `immutable`.
 */
export async function POST(request: Request) {
  const auth = await authorizeWrite("profileAsset");
  if ("response" in auth) return auth.response;

  try {
    const form = await readMultipart(request);
    const slot = parseSlot(form.get("slot"));
    if (!slot) return jsonError("Which slot? banner, logo or cover.", 400);

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Pick an image.", 400);
    }
    // Checked before buffering, so an oversized upload is rejected without being
    // read into memory first.
    if (file.size > limits.profileAssetUploadMaxBytes) {
      return jsonError(
        `Image is too big (max ${limits.profileAssetUploadMaxBytes / 1048576} MB).`,
        413,
      );
    }

    const asset = await putProfileAsset(
      auth.user,
      slot,
      Buffer.from(await file.arrayBuffer()),
    );
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Clear your banner or logo. A highlight cover is cleared through the highlight. */
export async function DELETE(request: Request) {
  const auth = await authorizeWrite("profileAsset");
  if ("response" in auth) return auth.response;

  try {
    const body = (await readJsonBody(request)) as { slot?: unknown };
    const slot = parseSlot(body.slot);
    if (slot !== "BANNER" && slot !== "LOGO") {
      return jsonError("Only a banner or logo can be cleared here.", 400);
    }

    await clearProfileAsset(auth.user, slot);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
