/**
 * Loading placeholders.
 *
 * Every one of these is the *shape* of the thing that is coming, not a spinner in the
 * middle of an empty box. That is the whole point: a rectangle where the avatar goes
 * and two bars where the name and the preview go tell you the page is arriving and
 * roughly what it will be, so nothing jumps when it does. A centred spinner tells you
 * only that you are waiting.
 *
 * The pulse is an opacity breath, defined once as the `skeleton` utility in
 * `app/globals.css` — no travelling highlight, because a shimmer is a gradient and
 * there are no gradients in this theme.
 *
 * These are plain server components with no state. They are what `loading.tsx` renders,
 * which means Next streams them as static HTML before any data is fetched.
 */

/** One pulsing block. `w`/`h` are Tailwind classes so callers keep the ladder. */
export function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} />;
}

/** A round one, for avatars. */
export function Dot({ size = 40 }: { size?: number }) {
  return (
    <span
      className="skeleton block shrink-0 rounded-pill"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Avatar plus two lines — a person in a list.
 *
 * The second bar's width alternates so a column of these does not read as a table.
 */
export function PersonRow({ size = 40, wide = false }: { size?: number; wide?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Dot size={size} />
      <div className="min-w-0 flex-1 space-y-2">
        <Bar className={`h-3 ${wide ? "w-40" : "w-28"} max-w-[60%]`} />
        <Bar className={`h-2.5 ${wide ? "w-56" : "w-44"} max-w-[85%]`} />
      </div>
    </div>
  );
}

/** A feed card: author row, then the media block, then the rating strip. */
export function PostSkeleton({ tall = true }: { tall?: boolean }) {
  return (
    <article className="panel overflow-hidden shadow-card">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Dot size={36} />
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-3 w-32 max-w-[50%]" />
          <Bar className="h-2.5 w-20" />
        </div>
      </div>
      <Bar className={`w-full rounded-none ${tall ? "h-[280px] sm:h-[360px]" : "h-24"}`} />
      <div className="flex items-center gap-2 px-3.5 py-3">
        <Bar className="h-8 w-8 rounded-pill" />
        <Bar className="h-8 w-8 rounded-pill" />
        <Bar className="h-8 w-8 rounded-pill" />
        <Bar className="ml-auto h-3 w-16" />
      </div>
    </article>
  );
}

/** A page's title block: a heading bar, and optionally a line under it. */
export function TitleSkeleton({ sub = true }: { sub?: boolean }) {
  return (
    <div className="space-y-2.5">
      <Bar className="h-5 w-48 max-w-[70%]" />
      {sub ? <Bar className="h-3 w-64 max-w-[85%]" /> : null}
    </div>
  );
}

/** `n` list rows inside a panel — the shape of a leaderboard or a people list. */
export function ListSkeleton({ rows = 8, wide = false }: { rows?: number; wide?: boolean }) {
  return (
    <ul className="panel divide-y divide-line overflow-hidden shadow-card">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="px-3.5 py-3">
          <PersonRow wide={wide} />
        </li>
      ))}
    </ul>
  );
}
