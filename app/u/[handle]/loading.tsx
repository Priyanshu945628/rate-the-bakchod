import { Bar, Dot, PostSkeleton } from "@/components/skeleton";

/**
 * A profile, before it arrives.
 *
 * No banner block. A banner is optional and most profiles have none, so drawing one
 * here would make the header collapse by 128px on the majority of profiles at exactly
 * the moment they fill in — the placeholder has to guess the common case, not the
 * decorated one.
 */
export default function ProfileLoading() {
  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <section className="panel overflow-hidden shadow-card">
        <div className="flex items-start gap-4 px-4 py-5 sm:px-5">
          <Dot size={72} />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Bar className="h-5 w-44 max-w-[65%]" />
            <Bar className="h-3 w-28" />
            <Bar className="h-3 w-40 max-w-[60%]" />
            <Bar className="h-3 w-full max-w-[92%]" />
          </div>
        </div>

        {/* The stats row: five labelled numbers, in the same gaps as the real one. */}
        <div className="flex flex-wrap gap-x-7 gap-y-3 border-t border-line px-4 py-3.5 sm:px-5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Bar className="skeleton-still h-2 w-16" />
              <Bar className="h-4 w-10" />
            </div>
          ))}
        </div>
      </section>

      <Bar className="ml-1 h-3.5 w-40" />

      <PostSkeleton />
      <PostSkeleton tall={false} />
    </div>
  );
}
