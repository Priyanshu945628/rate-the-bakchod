"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClientComment, ClientViewer } from "@/lib/types";
import { Avatar } from "./avatar";
import { SparkIcon, SpinnerIcon } from "./icons";
import { SignInPrompt } from "./sign-in-prompt";
import { TimeAgo } from "./time-ago";

/**
 * A post's comment thread. Loaded on open rather than with the feed — a page of
 * twelve posts should not drag every thread along with it.
 */
export function CommentThread({
  postId,
  viewer,
  onAdded,
}: {
  postId: string;
  viewer: ClientViewer | null;
  onAdded: () => void;
}) {
  const [comments, setComments] = useState<ClientComment[] | null>(null);
  // Null until the thread loads, so the composer is not flashed and then taken away
  // on a post whose author has comments switched off.
  const [allowComments, setAllowComments] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open, and abort if the thread closes first — a quick
  // open/close/open would otherwise leave two responses racing to land. Every
  // setState here sits inside a callback rather than in the effect body, which
  // is the shape the effect lint asks for and the reason this is not an
  // `await`-style helper.
  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/comments?postId=${encodeURIComponent(postId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          comments?: ClientComment[];
          allowComments?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Could not load comments.");
        return data;
      })
      .then((data) => {
        setComments(data.comments ?? []);
        setAllowComments(data.allowComments !== false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load comments.");
        setComments([]);
      });

    return () => controller.abort();
  }, [postId]);
  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, body }),
      });
      const data = (await res.json()) as { comment?: ClientComment; error?: string };
      if (!res.ok || !data.comment) {
        setError(data.error ?? "Could not post that.");
        return;
      }
      setComments((prev) => [...(prev ?? []), data.comment!]);
      setDraft("");
      onAdded();
    } catch {
      setError("Network gave up. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line px-4 py-3">
      {comments === null ? (
        <p className="flex items-center gap-2 py-2 text-xs text-faint">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          Loading the peanut gallery…
        </p>
      ) : comments.length === 0 ? (
        <p className="py-2 text-xs text-faint">No comments yet. Go on then.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Link
                href={`/u/${encodeURIComponent(c.author.handle)}`}
                aria-label={`${c.author.displayName}'s profile`}
                className="shrink-0"
              >
                <Avatar
                  src={c.author.avatarUrl}
                  name={c.author.displayName}
                  size={30}
                  isAI={c.author.isAI}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/u/${encodeURIComponent(c.author.handle)}`}
                    className="text-[13px] font-medium text-ink hover:underline"
                  >
                    {c.author.displayName}
                  </Link>
                  {c.author.isAI && (
                    <span className="flex items-center gap-1 rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <SparkIcon className="h-3 w-3" />
                      AI
                    </span>
                  )}
                  <TimeAgo iso={c.createdAt} className="text-[11px] text-faint" />
                </div>
                <p className="mt-0.5 text-sm leading-relaxed break-words text-ink/90">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {allowComments === false ? (
        <p className="mt-3 text-xs text-faint">
          Comments are off on this one. What is already here stays.
        </p>
      ) : viewer ? (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            maxLength={600}
            placeholder="Add your two rupees…"
            className="min-h-10 flex-1 resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink placeholder:text-faint"
          />
          {/* Outlined, not filled. A post card already spends its one accent on
              the Rate button, and two filled buttons in one card is the opposite
              of sparing. */}
          <button
            type="button"
            onClick={send}
            disabled={busy || draft.trim().length === 0}
            className="flex h-10 shrink-0 items-center gap-2 rounded-ctl border border-line-strong bg-panel-3 px-4 text-sm font-semibold text-ink transition-colors hover:border-ink disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            Send
          </button>
        </div>
      ) : (
        <SignInPrompt size="xs" className="mt-3">
          Sign in to join the bakchodi.
        </SignInPrompt>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
