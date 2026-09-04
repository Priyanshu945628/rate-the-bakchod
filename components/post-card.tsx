"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ClientPost, ClientViewer } from "@/lib/types";
import { limits } from "@/lib/config";
import { ActionMenu, type MenuAction } from "./action-menu";
import { Avatar } from "./avatar";
import {
  ChatIcon,
  FlagIcon,
  LinkIcon,
  PencilIcon,
  SparkIcon,
  SpinnerIcon,
  TrashIcon,
} from "./icons";
import { CommentThread } from "./comment-thread";
import { MediaView } from "./media-view";
import { RatePanel } from "./rate-panel";
import { TimeAgo } from "./time-ago";

/**
 * One feed item.
 *
 * Holds its own copy of the post so a rating, a comment or an edited caption
 * updates in place without refetching the page around it. The feed only ever
 * appends, so this copy never goes stale underneath us.
 *
 * A post a moderator deleted renders as a tombstone instead — see `Tombstone`.
 * That branch is only ever reached on the author's own profile, or in the hands of
 * the moderator who just pressed the button; every other query drops the post.
 *
 * An author deleting their own post leaves no tombstone. A moderator's delete is a
 * public act and says so; yours is nobody's business, and a marker reading "the
 * author deleted this" would be exactly the announcement that deleting it was
 * meant to avoid.
 */
export function PostCard({
  post: initial,
  viewer,
  openComments = false,
  onRemoved,
}: {
  post: ClientPost;
  viewer: ClientViewer | null;
  /**
   * Start with the thread expanded. The permalink sets it — arriving from a
   * comment notification and having to click "comments" to see the comment is
   * the wrong landing.
   */
  openComments?: boolean;
  /**
   * Drop this card from the list around it, after its author deletes it. Optional
   * because the two server-rendered call sites — the permalink and a pinned post —
   * have no list to drop it from, and fall back to the stub below.
   */
  onRemoved?: () => void;
}) {
  const [post, setPost] = useState(initial);
  const [showComments, setShowComments] = useState(openComments);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"mod" | "own" | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** One line under the card for whichever of these went wrong. */
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [gone, setGone] = useState(false);

  const mine = viewer !== null && viewer.id === post.author.id;

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

  /** Moderator delete. Collapses this card into its own tombstone on success. */
  async function modDelete() {
    setDeleting(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "modDelete", postId: post.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote(data.error ?? "Could not delete.");
        return;
      }
      setConfirming(null);
      // Flipping the local copy is the confirmation: the card becomes the same
      // tombstone the author will see, in place, with no refetch of the feed around it.
      setPost((p) => ({ ...p, modDeleted: true }));
    } catch {
      setNote("Could not delete.");
    } finally {
      setDeleting(false);
    }
  }

  /**
   * The author deleting their own. Irreversible in the strongest sense available:
   * the server destroys the key the archived media is encrypted with.
   */
  async function deleteOwn() {
    setDeleting(true);
    setNote(null);
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(post.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote(data.error ?? "Could not delete.");
        return;
      }
      setConfirming(null);
      onRemoved?.();
      setGone(true);
    } catch {
      setNote("Could not delete.");
    } finally {
      setDeleting(false);
    }
  }

  /** Save an edited caption. An empty draft clears it rather than failing. */
  async function saveCaption() {
    const next = draft.trim();
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(post.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: next || null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        caption?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setNote(data.error ?? "Could not save.");
        return;
      }
      // The server's own answer, not the draft: it trims and it may have rejected
      // trailing whitespace differently than this did.
      setPost((p) => ({ ...p, caption: data.caption ?? null }));
      setEditing(false);
    } catch {
      setNote("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${post.id}`);
    } catch {
      setNote("Could not copy the link.");
    }
  }

  const actions: MenuAction[] = [];
  if (mine) {
    actions.push({
      label: "Edit caption",
      icon: PencilIcon,
      run: () => {
        setDraft(post.caption ?? "");
        setEditing(true);
      },
    });
  }
  actions.push({ label: "Copy link", icon: LinkIcon, run: () => void copyLink() });
  if (mine) {
    actions.push({
      label: "Delete",
      icon: TrashIcon,
      run: () => setConfirming("own"),
      danger: true,
    });
  }

  // Nothing to draw, and nothing honest to draw in its place. The two server-rendered
  // call sites land here; a feed will have pruned the card before this renders.
  if (gone) {
    return <p className="panel px-4 py-3 text-xs text-muted">Deleted.</p>;
  }

  if (post.modDeleted) return <Tombstone post={post} />;

  return (
    <article className="panel overflow-hidden shadow-card">
      <AuthorHeader
        post={post}
        trailing={<ActionMenu label="Post options" actions={actions} />}
      />

      {editing ? (
        <div className="px-4 pb-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={limits.captionMaxLength}
            rows={3}
            aria-label="Caption"
            className="focus-bare w-full resize-none rounded-ctl border border-line-strong bg-panel-2 px-3 py-2 text-[15px] leading-relaxed text-ink placeholder:text-faint"
            placeholder="Say what happened."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveCaption()}
              disabled={saving}
              className="flex h-9 items-center gap-2 rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <SpinnerIcon className="h-4 w-4 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-9 rounded-ctl border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <span className="ml-auto text-[11px] tabular-nums text-faint">
              {limits.captionMaxLength - draft.length}
            </span>
          </div>
        </div>
      ) : (
        post.caption && (
          <p className="px-4 pb-3 text-[15px] leading-relaxed break-words text-ink/95">
            {post.caption}
          </p>
        )
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

        {/* Moderators only, and enforced again in `POST /api/admin` — this button
            being drawn is a convenience, not the permission. */}
        {viewer?.isAdmin && (
          <button
            type="button"
            onClick={() => setConfirming((c) => (c === "mod" ? null : "mod"))}
            aria-expanded={confirming === "mod"}
            className="flex h-9 items-center gap-2 rounded-ctl px-3 text-xs font-medium text-muted transition-colors hover:bg-panel-2 hover:text-danger"
          >
            <TrashIcon className="h-4 w-4" />
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-muted">Delete this post?</span>
          <button
            type="button"
            onClick={confirming === "mod" ? modDelete : deleteOwn}
            disabled={deleting}
            className="ml-auto flex h-9 items-center gap-2 rounded-ctl border border-line px-4 text-sm font-medium text-danger transition-colors hover:border-danger disabled:opacity-50"
          >
            {deleting && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="h-9 shrink-0 rounded-ctl border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {note && (
        <p className="border-t border-line px-4 py-2 text-xs text-danger">{note}</p>
      )}

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

/**
 * Who posted it and when, plus whatever the card wants on the right.
 *
 * Shared with the tombstone, which keeps this and drops the rest — and passes no
 * `trailing`, because there is nothing left to act on.
 */
function AuthorHeader({ post, trailing }: { post: ClientPost; trailing?: ReactNode }) {
  const profileHref = `/u/${encodeURIComponent(post.author.handle)}`;

  return (
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
      {trailing}
    </header>
  );
}

/**
 * What is left of a post a moderator deleted.
 *
 * The header stays so the author can tell which post it was; the media, the score,
 * the thread and the report button all go, because none of them still have a
 * subject. `toClientPost` withholds the media URLs as well, so this is not merely a
 * component that declines to draw them.
 */
function Tombstone({ post }: { post: ClientPost }) {
  return (
    <article className="panel overflow-hidden opacity-75 shadow-card">
      <AuthorHeader post={post} />
      <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted">
        <TrashIcon className="h-4 w-4 shrink-0 text-faint" />
        Deleted by a moderator
      </p>
    </article>
  );
}
