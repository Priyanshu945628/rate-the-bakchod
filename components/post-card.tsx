"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientPost, ClientViewer } from "@/lib/types";
import { Avatar } from "./avatar";
import { ChatIcon, FlagIcon, SparkIcon } from "./icons";
import { CommentThread } from "./comment-thread";
import { MediaView } from "./media-view";
import { RatePanel } from "./rate-panel";
import { TimeAgo } from "./time-ago";

/**
 * One feed item.
 *
 * Holds its own copy of the post so a rating or a comment updates in place
 * without refetching the page around it. The feed only ever appends, so this
 * copy never goes stale underneath us.
 */
export function PostCard({
  post: initial,
  viewer,
  openComments = false,
}: {
  post: ClientPost;
  viewer: ClientViewer | null;
  /**
   * Start with the thread expanded. The permalink sets it — arriving from a
   * comment notification and having to click "comments" to see the comment is
   * the wrong landing.
   */
  openComments?: boolean;
}) {
  const [post, setPost] = useState(initial);
  const [showComments, setShowComments] = useState(openComments);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState<string | null>(null);

  const profileHref = `/u/${encodeURIComponent(post.author.handle)}`;

  async function sendReport() {
    const reason = reportReason.trim();
    if (!reason) return;
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId: post.id, reason }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setReportNote(res.ok ? "Reported. A human will look." : (data.error ?? "Could not report."));
    if (res.ok) {
      setReporting(false);
      setReportReason("");
    }
  }

  return (
    <article className="panel overflow-hidden shadow-card">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <Link
          href={profileHref}
          aria-label={`${post.author.displayName}'s profile`}
          className="shrink-0"
        >
          <Avatar
            src={post.author.avatarUrl}
            name={post.author.displayName}
            isAI={post.author.isAI}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={profileHref}
              className="truncate text-[15px] font-semibold text-ink hover:underline"
            >
              {post.author.displayName}
            </Link>
            {post.author.isAI ? (
              <span className="flex items-center gap-1 rounded-pill border border-line-strong bg-panel-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                <SparkIcon className="h-3 w-3" />
                AI
              </span>
            ) : post.author.bakchodScore > 0 ? (
              <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold text-muted">
                {post.author.bakchodScore.toFixed(1)} bakchod
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-faint">
            <Link href={profileHref} className="truncate transition-colors hover:text-muted">
              @{post.author.handle}
            </Link>
            <span aria-hidden>·</span>
            <TimeAgo iso={post.createdAt} />
          </div>
        </div>
      </header>

      {post.caption && (
        <p className="px-4 pb-3 text-[15px] leading-relaxed break-words text-ink/95">
          {post.caption}
        </p>
      )}

      <MediaView post={post} />

      {/* A tweet post can carry both a screenshot and the pasted text. */}
      {post.kind === "TWEET" && post.mediaUrl && post.tweetText && (
        <blockquote className="mx-4 mb-4 rounded-ctl border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
          {post.tweetText}
        </blockquote>
      )}

      <RatePanel
        post={post}
        viewer={viewer}
        onRated={({ average, ratingsCount, mine }) =>
          setPost((p) => ({
            ...p,
            average,
            ratingsCount,
            ratingsSum: Math.round(average * ratingsCount),
            viewerRating: mine,
          }))
        }
      />

      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          className="flex h-9 items-center gap-2 rounded-ctl px-3 text-xs font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <ChatIcon className="h-4 w-4" />
          {post.commentsCount === 1 ? "1 comment" : `${post.commentsCount} comments`}
        </button>

        <button
          type="button"
          onClick={() => setReporting((v) => !v)}
          className="ml-auto flex h-9 items-center gap-2 rounded-ctl px-3 text-xs font-medium text-muted transition-colors hover:bg-panel-2 hover:text-danger"
        >
          <FlagIcon className="h-4 w-4" />
          Report
        </button>
      </div>

      {reporting && (
        <div className="border-t border-line px-4 py-3">
          <label className="text-xs text-muted" htmlFor={`report-${post.id}`}>
            What is wrong with it?
          </label>
          <div className="mt-2 flex items-end gap-2">
            <input
              id={`report-${post.id}`}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              maxLength={300}
              className="h-10 flex-1 rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
              placeholder="Harassment, nudity, someone's private photo…"
            />
            <button
              type="button"
              onClick={sendReport}
              disabled={reportReason.trim().length === 0}
              className="h-10 shrink-0 rounded-ctl border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {reportNote && (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">{reportNote}</p>
      )}

      {showComments && (
        <CommentThread
          postId={post.id}
          viewer={viewer}
          onAdded={() =>
            setPost((p) => ({ ...p, commentsCount: p.commentsCount + 1 }))
          }
        />
      )}
    </article>
  );
}
