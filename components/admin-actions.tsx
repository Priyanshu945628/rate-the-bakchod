"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminReportRow } from "@/lib/moderation";
import { SpinnerIcon } from "./icons";

type Action = "hide" | "unhide" | "shred" | "resolve" | "wipeTheme";

/**
 * Moderation buttons.
 *
 * "Shred" is the destructive one and is worth understanding: the archive has no
 * delete, so it destroys the wrapped data key instead. The ciphertext stays where
 * it is and becomes permanently unreadable. There is no undo, hence the confirm.
 *
 * "Wipe theme" is the answer to a profile whose decoration is the problem — a
 * strobing intro, a slur in a tagline. It resets the theme to stock and touches
 * nothing else: the account, its posts and its score all survive. It acts on the
 * post's author rather than the post, which is why it sits apart from the others.
 */
export function AdminActions({ report }: { report: AdminReportRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  // Carries its own tone because one action reports success: wiping a theme changes
  // nothing visible on this page, so "it worked" has to be said rather than shown.
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  async function run(action: Action) {
    if (action === "shred" && !confirm("Destroy the key for this media? This cannot be undone.")) {
      return;
    }
    if (
      action === "wipeTheme" &&
      !confirm(`Reset @${report.post.authorHandle}'s profile decoration to stock?`)
    ) {
      return;
    }
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "resolve"
            ? { action, reportId: report.id }
            : action === "wipeTheme"
              ? { action, handle: report.post.authorHandle }
              : { action, postId: report.post.id },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote({ text: data.error ?? "Action failed.", ok: false });
        return;
      }
      if (action === "wipeTheme") setNote({ text: "Theme reset to stock.", ok: true });
      router.refresh();
    } catch {
      setNote({ text: "Action failed.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  const button =
    "flex h-9 items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => run(report.post.isHidden ? "unhide" : "hide")}
        disabled={busy !== null}
        className={`${button} text-ink hover:border-line-strong`}
      >
        {(busy === "hide" || busy === "unhide") && (
          <SpinnerIcon className="h-4 w-4 animate-spin" />
        )}
        {report.post.isHidden ? "Unhide" : "Hide"}
      </button>

      <button
        type="button"
        onClick={() => run("shred")}
        disabled={busy !== null || !report.post.hasKey}
        className={`${button} text-danger hover:border-danger`}
      >
        {busy === "shred" && <SpinnerIcon className="h-4 w-4 animate-spin" />}
        {report.post.hasKey ? "Shred media" : "Already shredded"}
      </button>

      <button
        type="button"
        onClick={() => run("wipeTheme")}
        disabled={busy !== null}
        className={`${button} text-muted hover:border-line-strong hover:text-ink`}
      >
        {busy === "wipeTheme" && <SpinnerIcon className="h-4 w-4 animate-spin" />}
        Wipe theme
      </button>

      <button
        type="button"
        onClick={() => run("resolve")}
        disabled={busy !== null}
        className={`${button} ml-auto text-muted hover:border-line-strong hover:text-ink`}
      >
        {busy === "resolve" && <SpinnerIcon className="h-4 w-4 animate-spin" />}
        Dismiss report
      </button>

      {note && (
        <p className={`w-full text-xs ${note.ok ? "text-muted" : "text-danger"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
