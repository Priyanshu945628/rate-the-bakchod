import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchReportRows } from "@/lib/moderation";
import { AdminActions } from "@/components/admin-actions";
import { TimeAgo } from "@/components/time-ago";

export const metadata: Metadata = {
  title: "Moderation · Rate the Bakchod",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await getCurrentUser();
  // Straight home rather than a 403 or a wall. Nobody who isn't an admin has any
  // business being told this page exists at all, let alone that they are missing
  // a permission — and `robots: noindex` above keeps it out of search either way.
  if (!user?.isAdmin) redirect("/");

  const reports = await fetchReportRows();

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4">
      <header className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Moderation</h1>
        <p className="mt-1 text-sm text-muted">
          {reports.length === 0
            ? "No open reports."
            : `${reports.length} open ${reports.length === 1 ? "report" : "reports"}.`}
        </p>
      </header>

      {reports.map((report) => (
        <article key={report.id} className="panel overflow-hidden shadow-card">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-3">
            <span className="text-sm text-ink">
              @{report.reporterHandle} reported @{report.post.authorHandle}
            </span>
            <TimeAgo iso={report.createdAt} className="text-xs text-faint" />
            <span className="ml-auto flex gap-2">
              {report.post.isHidden && (
                <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                  hidden
                </span>
              )}
              <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {report.post.archiveState.toLowerCase()}
              </span>
            </span>
          </div>

          <p className="px-4 pt-3 text-sm text-ink">
            <span className="text-faint">Reason: </span>
            {report.reason}
          </p>

          <div className="flex gap-3 px-4 py-3">
            {report.post.mediaUrl && report.post.hasKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.post.mediaUrl}
                alt=""
                className="h-24 w-24 shrink-0 rounded-ctl border border-line object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-ctl border border-line bg-panel-2 text-center text-[10px] leading-tight text-faint">
                {report.post.hasKey ? "no media" : "key destroyed"}
              </span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-xs uppercase tracking-wide text-faint">
                {report.post.kind}
              </p>
              {report.post.caption && (
                <p className="mt-1 break-words text-ink/90">{report.post.caption}</p>
              )}
              {report.post.tweetText && (
                <p className="mt-1 break-words text-muted">
                  &ldquo;{report.post.tweetText}&rdquo;
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-line px-4 py-3">
            <AdminActions report={report} />
          </div>
        </article>
      ))}
    </div>
  );
}
