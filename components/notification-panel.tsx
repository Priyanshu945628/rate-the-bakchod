"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientNotification, ClientNotificationPage } from "@/lib/types";
import { Avatar } from "./avatar";
import { BellIcon, SpinnerIcon } from "./icons";
import { TimeAgo } from "./time-ago";
import { useRealtime } from "./realtime-provider";

/**
 * The notifications panel — a screen of its own, reached from the bell.
 *
 * It used to be a dropdown hanging off the bell, and on a phone that is a 360px card
 * anchored to a button in the corner of a 390px viewport: it either hangs off the edge
 * or it is squeezed into a column too narrow for the sentences in it. A surface that
 * has to fit inside its own trigger is the wrong shape for a list, so this is a page.
 * The bell keeps the badge and becomes a link to it.
 *
 * The first page is server-rendered and handed in, so the list is there in the first
 * paint. After that it is a client surface: arrivals are prepended from the realtime
 * stream, and "Older" pages through the same route the bell used to call.
 *
 * Opening marks everything read — once, on mount — while the rows keep the tint they
 * arrived with. Seeing which ones were new is the point of opening it, so clearing the
 * badge and clearing the highlight are deliberately not the same act.
 */
export function NotificationPanel({ initial }: { initial: ClientNotificationPage }) {
  const [rows, setRows] = useState<ClientNotification[]>(initial.notifications);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  /** Marking read is a one-shot, and a ref rather than state — nothing draws it. */
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || initial.unread === 0) return;
    marked.current = true;
    // The response is not read: the server publishes the new total to every tab of
    // this account, which is what the bell's badge is listening to.
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [initial.unread]);

  useRealtime(
    useCallback((event) => {
      if (event.type !== "notification") return;
      setRows((prev) => [
        { ...event.notification, read: false },
        ...prev.filter((r) => r.id !== event.notification.id),
      ]);
    }, []),
  );

  const older = useCallback(async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(next)}`);
      const data = (await res.json()) as ClientNotificationPage & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load.");
      setRows((prev) => [...prev, ...data.notifications]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3">
      <header className="flex items-center gap-2 px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Notifications</h1>
        {busy ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin text-faint" /> : null}
      </header>

      <div className="panel overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16">
            <BellIcon className="h-6 w-6 text-faint" />
            <p className="text-sm text-faint">Nothing yet.</p>
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                onNavigate={() =>
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, read: true } : r)),
                  )
                }
                onRefresh={() => router.refresh()}
              />
            ))}
          </ul>
        )}

        {cursor ? (
          <button
            type="button"
            onClick={() => void older(cursor)}
            disabled={busy}
            className="w-full border-t border-line px-4 py-3 text-[13px] font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            Older
          </button>
        ) : null}

        {error ? (
          <p className="border-t border-line px-4 py-2.5 text-xs text-danger">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One row. A `Link` when there is somewhere to go and a plain `div` when there is
 * not — the two `ADMIN_*` types have no destination, and an anchor to nowhere is a
 * trap for anyone using a keyboard.
 */
function Row({
  row,
  onNavigate,
  onRefresh,
}: {
  row: ClientNotification;
  onNavigate: () => void;
  onRefresh: () => void;
}) {
  const body = (
    <>
      <span className="shrink-0">
        <Avatar
          src={row.actor?.avatarUrl ?? null}
          name={row.actor?.displayName ?? "System"}
          size={36}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] leading-snug text-ink/90">{row.text}</span>
        <TimeAgo iso={row.createdAt} className="mt-0.5 block text-[11px] text-faint" />
      </span>
      {!row.read && (
        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-ink" />
      )}
    </>
  );

  const shell = "flex w-full items-start gap-3 px-4 py-3 text-left";

  return (
    <li className={`border-b border-line last:border-b-0 ${row.read ? "" : "bg-panel-2"}`}>
      {row.href ? (
        <Link
          href={row.href}
          onClick={() => {
            onNavigate();
            // The destination is server-rendered and may already have been fetched —
            // a comment notification pointing at a post whose thread is in the router
            // cache would show the page without the new comment.
            onRefresh();
          }}
          className={`${shell} transition-colors hover:bg-panel-3`}
        >
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}
