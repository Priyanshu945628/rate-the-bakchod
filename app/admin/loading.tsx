import { Bar } from "@/components/skeleton";

/**
 * Moderation, before it arrives.
 *
 * The subtitle is a count, so unlike the leaderboard's it is a bar rather than the real
 * line — it is one of the things being waited for.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4">
      <header className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Moderation</h1>
        <Bar className="mt-2 h-3 w-32" />
      </header>

      {Array.from({ length: 3 }, (_, i) => (
        <article key={i} className="panel overflow-hidden shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Bar className="skeleton-still h-3 w-40 max-w-[50%]" />
            <Bar className="ml-auto h-4 w-16 rounded-pill" />
          </div>
          <div className="flex gap-3 px-4 py-3">
            <Bar className="h-24 w-24 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="skeleton-still h-2.5 w-20" />
              <Bar className="h-3 w-full max-w-[85%]" />
              <Bar className="h-3 w-48 max-w-[55%]" />
            </div>
          </div>
          <div className="flex gap-2 border-t border-line px-4 py-3">
            <Bar className="h-7 w-20 rounded-pill" />
            <Bar className="h-7 w-20 rounded-pill" />
            <Bar className="h-7 w-24 rounded-pill" />
          </div>
        </article>
      ))}
    </div>
  );
}
