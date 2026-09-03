import Link from "next/link";

/**
 * 404. Reached most often by an @handle that does not exist, so the copy points
 * back at the two pages that always do.
 */
export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[560px] pt-6">
      <section className="panel px-5 py-6 shadow-card">
        <h1 className="text-lg font-bold text-ink">Nothing here</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          That page does not exist. If you were looking for someone, the handle
          may have changed — or they were never on here to begin with.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="flex h-10 items-center rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            Back to the feed
          </Link>
          <Link
            href="/leaderboard"
            className="flex h-10 items-center rounded-ctl border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Leaderboard
          </Link>
        </div>
      </section>
    </div>
  );
}
