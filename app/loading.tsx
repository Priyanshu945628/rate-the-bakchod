import { Bar, Dot, PersonRow, PostSkeleton } from "@/components/skeleton";

/**
 * The feed, before it arrives.
 *
 * This is the root segment's fallback, so it also stands in for any route that has
 * not got a `loading.tsx` of its own. That is deliberate — a feed shape is the most
 * honest guess for a page nobody wrote a placeholder for, and it is closer to right
 * than a spinner is for any of them.
 *
 * Three cards, not one and not ten: one reads as a page that finished loading badly,
 * and ten push the real first card down a screen when they are replaced.
 */
export default function FeedLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-3">
      <div className="min-w-0 flex-1 space-y-3 xl:max-w-[640px]">
        {/* The story strip. `skeleton-still` on the ring row so a page of
            placeholders does not strobe — the cards below carry the pulse. */}
        <section className="panel flex gap-3.5 overflow-hidden px-3.5 py-3 shadow-card">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex w-[64px] shrink-0 flex-col items-center gap-1.5">
              <span className="skeleton-still h-[58px] w-[58px] rounded-pill" />
              <span className="skeleton-still h-2 w-10 rounded-pill" />
            </div>
          ))}
        </section>

        <div className="panel px-4 py-4 shadow-card">
          <div className="flex items-center gap-3">
            <Dot size={36} />
            <Bar className="h-9 flex-1" />
          </div>
        </div>

        <PostSkeleton />
        <PostSkeleton tall={false} />
        <PostSkeleton />
      </div>

      <aside className="hidden w-[340px] shrink-0 xl:block">
        <div className="sticky top-[80px] space-y-3">
          <div className="panel space-y-3 px-3.5 py-3 shadow-card">
            <Bar className="h-3 w-28" />
            {Array.from({ length: 5 }, (_, i) => (
              <PersonRow key={i} size={32} />
            ))}
          </div>
          <div className="panel space-y-3 px-3.5 py-3 shadow-card">
            <Bar className="h-3 w-32" />
            {Array.from({ length: 3 }, (_, i) => (
              <PersonRow key={i} size={32} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
