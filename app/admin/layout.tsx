import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureAdminProfile, ensureHouseAccounts } from "@/lib/house-accounts";

/**
 * No frame — this layout exists to run the house setup.
 *
 * The two house accounts and the admin's own profile used to be ensured inside
 * `/admin` itself, which meant they were only ensured if you happened to open the
 * moderation page. An admin who went straight to `/admin/bot` — the page you actually
 * open to change the cadence — never triggered any of it, so the bot's avatar, its
 * bio and the platform account existed only in the code. In production the other
 * trigger, `ensureAIUser` inside the tick, is no help either: nothing schedules
 * `/api/cron/bakchod`, so it fires when somebody presses Run and not before.
 *
 * A layout runs for every page beneath it, so opening any admin surface is enough.
 * The work is idempotent and read-first, so after the first load it is three selects.
 *
 * `getCurrentUser` is `cache()`d per request, so calling it here and again in the page
 * below is one query, not two. The pages keep their own admin check regardless: a
 * layout guard is a convenience, not a boundary — Next may serve a page's segment
 * without re-running the layout above it, and the redirect belongs next to the data.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect("/");

  // Warn and carry on. A container whose sharp cannot rasterise SVG, or a database
  // that just lost its pool, is a missing avatar — not a reason moderation is
  // unreachable.
  await Promise.all([ensureHouseAccounts(), ensureAdminProfile(user)]).catch((err) =>
    console.warn("[admin] account setup skipped:", err),
  );

  return children;
}
