import { Bar, PostSkeleton } from "@/components/skeleton";

/**
 * One post on its own page, before it arrives.
 *
 * The comment thread comes down with the post here rather than on open, so the wait is
 * for both and the placeholder shows both: the card, then the rows under it.
 */
export default function PostLoading() {
  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <Bar className="ml-1 h-3 w-24" />
      <PostSkeleton />
      <div className="panel space-y-3.5 px-3.5 py-3.5 shadow-card">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-2.5">
            <span className="skeleton block h-8 w-8 shrink-0 rounded-pill" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="skeleton-still h-2.5 w-24" />
              <Bar className={`h-3 ${i % 2 === 0 ? "w-full max-w-[80%]" : "w-48 max-w-[60%]"}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
