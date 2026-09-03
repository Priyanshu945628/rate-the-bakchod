import type { Metadata } from "next";
import { fetchLeaderboard } from "@/lib/posts";
import { LeaderboardPanel } from "@/components/leaderboard-panel";

export const metadata: Metadata = {
  title: "Leaderboard · Rate the Bakchod",
};

export default async function LeaderboardPage() {
  const rows = await fetchLeaderboard(50);

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted">
          Ranked by weighted Bakchod Score, so volume counts.
        </p>
      </header>

      <LeaderboardPanel rows={rows} showAll />
    </div>
  );
}
