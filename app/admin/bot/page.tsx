import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readBotStatus } from "@/lib/ai/settings";
import { BotSettings } from "@/components/bot-settings";

export const metadata: Metadata = {
  title: "Bot · Rate the Bakchod",
  robots: { index: false, follow: false },
};

// The status includes whether a key is stored, so it must never be cached.
export const dynamic = "force-dynamic";

/**
 * The AI bakchod's controls.
 *
 * Cadence and credentials both live in a database row, so everything on this page
 * takes effect on the next tick rather than the next deploy — the point being that a
 * gateway which has started refusing requests is something to fix from a phone.
 *
 * {@link readBotStatus} is the only reader involved, and it returns no credential
 * values at all: which of the three is configured and where it came from, nothing
 * more. Same reasoning as `/admin`: a non-admin goes straight home.
 */
export default async function AdminBotPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect("/");

  const status = await readBotStatus();

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Bot</h1>
        <Link
          href="/admin"
          className="text-sm text-muted transition-colors hover:text-ink"
        >
          Moderation
        </Link>
        <Link
          href="/admin/updates"
          className="text-sm text-muted transition-colors hover:text-ink"
        >
          Updates
        </Link>
      </header>

      <BotSettings initial={status} />
    </div>
  );
}
