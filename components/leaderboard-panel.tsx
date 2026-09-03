import Link from "next/link";
import type { LeaderboardRow } from "@/lib/types";
import { Avatar } from "./avatar";
import { TrophyIcon } from "./icons";

/**
 * The leaderboard.
 *
 * The AI bakchod is filtered out at the query, not here — it posts and comments
 * like everyone else, but it is never scored and never ranked.
 *
 * The only accent-coloured thing in the app that is not a primary button is the
 * top-three rank number here. The score itself stays `ink`: what the accent marks
 * is the position, and lifting both would mean lifting every row.
 */
export function LeaderboardPanel({
  rows,
  showAll = false,
}: {
  rows: LeaderboardRow[];
  showAll?: boolean;
}) {
  return (
    <section className="panel overflow-hidden shadow-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <TrophyIcon className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold text-ink">Biggest bakchods</h2>
        {!showAll && (
          <Link
            href="/leaderboard"
            className="ml-auto text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            Full list
          </Link>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-faint">
          Nobody has been rated yet. The throne is open.
        </p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((row, index) => (
            <li key={row.id}>
              <Link
                href={`/u/${encodeURIComponent(row.handle)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2"
              >
                <span
                  className={`w-6 shrink-0 text-center text-sm font-bold tabular-nums ${
                    index < 3 ? "text-accent" : "text-faint"
                  }`}
                >
                  {index + 1}
                </span>
                <Avatar src={row.avatarUrl} name={row.displayName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {row.displayName}
                  </p>
                  <p className="truncate text-xs text-faint">
                    @{row.handle} · {row.ratingsCount}{" "}
                    {row.ratingsCount === 1 ? "rating" : "ratings"}
                  </p>
                </div>
                <span className="shrink-0 text-[15px] font-bold tabular-nums text-ink">
                  {row.bakchodScore.toFixed(2)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
