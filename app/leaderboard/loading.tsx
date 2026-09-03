import { ListSkeleton } from "@/components/skeleton";

/**
 * The leaderboard, before it arrives.
 *
 * The heading is drawn for real, not as bars. It does not depend on the query that is
 * still running, so a placeholder there would be pretending to wait for something
 * already known — and it would move when it filled in. Same rule as
 * `components/messages/inbox-skeleton.tsx`.
 */
export default function LeaderboardLoading() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted">
          Ranked by weighted Bakchod Score, so volume counts.
        </p>
      </header>

      <ListSkeleton rows={12} wide />
    </div>
  );
}
