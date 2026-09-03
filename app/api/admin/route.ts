import { NextResponse } from "next/server";
import { handleRouteError, jsonError, readJsonBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { wipeTheme } from "@/lib/profile";

export const runtime = "nodejs";

/**
 * Moderation actions. Post-hoc only — the platform is transparent by design, so
 * nothing is screened on the way in; things get hidden after they are reported.
 *
 * `hide` and `modDelete` differ only in what the author is told: a hidden post
 * simply stops appearing anywhere, a deleted one leaves a tombstone on the
 * author's own profile and rings their bell. Both set `isHidden`, which is the
 * column every read already filters on.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireUser();
    if (!admin.isAdmin) return jsonError("Not your button.", 403);

    const body = (await readJsonBody(request)) as {
      postId?: unknown;
      action?: unknown;
      reportId?: unknown;
      handle?: unknown;
    };

    const postId = typeof body.postId === "string" ? body.postId : null;
    const action = body.action;

    if (action === "hide" || action === "unhide" || action === "modDelete") {
      if (!postId) return jsonError("Which post?", 400);
      const hide = action !== "unhide";
      const deleted = action === "modDelete";
      const now = new Date();
      const post = await prisma.post.update({
        where: { id: postId },
        data: {
          isHidden: hide,
          hiddenAt: hide ? now : null,
          // A deletion is a hide plus a marker the author is shown; `isHidden` is
          // what every query already excludes, so enforcement needs nothing new.
          // Unhiding clears the marker, so a restore is a real restore rather than a
          // post that is visible again while still a tombstone on its own profile.
          // Plain `hide` leaves it as it was: hiding something already deleted
          // changes nothing about it.
          ...(deleted ? { modDeletedAt: now } : {}),
          ...(action === "unhide" ? { modDeletedAt: null } : {}),
        },
        select: { authorId: true },
      });
      // No actor on either: which moderator pressed the button is not the author's
      // business, and naming one turns a policy decision into a personal one.
      // Unhiding notifies nobody — there is nothing to apologise for in a bell.
      if (hide) {
        void notify({
          userId: post.authorId,
          type: deleted ? "ADMIN_DELETE" : "ADMIN_HIDE",
          postId,
        });
      }
      return NextResponse.json({ ok: true, isHidden: hide, modDeleted: deleted });
    }

    if (action === "shred") {
      if (!postId) return jsonError("Which post?", 400);
      // Crypto-shred. Internet Archive has no delete, so destroying the wrapped
      // key is the deletion: the archived ciphertext can never be read again.
      const post = await prisma.post.update({
        where: { id: postId },
        data: {
          isHidden: true,
          hiddenAt: new Date(),
          wrappedKey: null,
          keyIv: null,
          keyTag: null,
        },
        select: { authorId: true },
      });
      void notify({ userId: post.authorId, type: "ADMIN_HIDE", postId });
      return NextResponse.json({ ok: true, shredded: true });
    }

    if (action === "resolve") {
      const reportId = typeof body.reportId === "string" ? body.reportId : null;
      if (!reportId) return jsonError("Which report?", 400);
      await prisma.report.update({
        where: { id: reportId },
        data: { resolvedAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "wipeTheme") {
      // For a theme that is abusive rather than merely ugly — a strobing intro, a
      // slur in a tagline. Strips the decoration back to stock and leaves the
      // account, its posts and its score alone.
      const handle = typeof body.handle === "string" ? body.handle : null;
      if (!handle) return jsonError("Whose theme?", 400);
      const wiped = await wipeTheme(handle);
      if (!wiped) return jsonError("No such user.", 404);
      return NextResponse.json({ ok: true, wiped: true });
    }

    return jsonError("Unknown action.", 400);
  } catch (err) {
    return handleRouteError(err);
  }
}
