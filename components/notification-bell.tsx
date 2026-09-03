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
 * The bell.
 *
 * Two states worth being careful about. The badge is live — it comes down the
 * realtime stream and must be right without the dropdown ever having been opened,
 * so the count is state of its own and not derived from the loaded list. The list
 * is lazy: it is fetched the first time the dropdown opens, and after that a
 * pushed notification is prepended in place rather than triggering a refetch.
 *
 * Opening also marks everything read, which is why the badge clears on click and
 * the rows keep their unread tint until the dropdown is closed and reopened —
 * seeing which ones were new is the point of opening it.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [rows, setRows] = useState<ClientNotification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useRealtime(
    useCallback((event) => {
      // Opening a thread marks the MESSAGE row it left behind read, and that
      // correction arrives here rather than as a notification of its own.
      if (event.type === "unread") {
        setUnread(event.notifications);
        return;
      }
      if (event.type !== "notification") return;
      setUnread(event.unread);
      // Only splice into a list that exists. Building one here would half-fill the
      // dropdown, and the next open would show a page that starts in the middle.
      setRows((prev) =>
        prev === null
          ? prev
          : [
              {
                ...event.notification,
                read: false,
              },
              ...prev.filter((r) => r.id !== event.notification.id),
            ],
      );
    }, []),
  );

  const load = useCallback(async (next?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        next ? `/api/notifications?cursor=${encodeURIComponent(next)}` : "/api/notifications",
      );
      const data = (await res.json()) as ClientNotificationPage & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load.");
      setRows((prev) => (next && prev ? [...prev, ...data.notifications] : data.notifications));
      setCursor(data.nextCursor);
      if (!next) setUnread(data.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Clicking anywhere else closes it, and so does Escape. Both listeners are
  // attached by the effect rather than being props on the panel, because a click
  // outside is by definition not on anything this component rendered.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    if (rows === null) void load();
    if (unread > 0) {
      // Optimistic, and safe to be: the server call only ever lowers the number,
      // so a failure resolves itself on the next push or reload.
      setUnread(0);
      void fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 text-[10px] font-bold tabular-nums text-panel">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="panel absolute right-0 top-11 z-30 w-[min(360px,calc(100vw-2rem))] overflow-hidden shadow-card">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Notifications</h2>
            {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin text-faint" />}
          </div>

          <div className="max-h-[min(420px,60vh)] overflow-y-auto">
            {rows === null ? (
              <p className="px-3.5 py-6 text-center text-xs text-faint">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-xs text-faint">Nothing yet.</p>
            ) : (
              <ul>
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    onNavigate={() => {
                      setOpen(false);
                      setRows((prev) =>
                        prev?.map((r) => (r.id === row.id ? { ...r, read: true } : r)) ?? prev,
                      );
                    }}
                    onRefresh={() => router.refresh()}
                  />
                ))}
              </ul>
            )}

            {cursor && rows !== null && (
              <button
                type="button"
                onClick={() => void load(cursor)}
                disabled={busy}
                className="w-full border-t border-line px-3.5 py-2.5 text-xs font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
              >
                Older
              </button>
            )}
          </div>

          {error && (
            <p className="border-t border-line px-3.5 py-2 text-xs text-danger">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row. A `Link` when there is somewhere to go and a plain `div` when there is
 * not — `ADMIN_HIDE` has no destination, and an anchor to nowhere is a trap for
 * anyone using a keyboard.
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
        <Avatar src={row.actor?.avatarUrl ?? null} name={row.actor?.displayName ?? "System"} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-ink/90">{row.text}</span>
        <TimeAgo iso={row.createdAt} className="mt-0.5 block text-[11px] text-faint" />
      </span>
      {!row.read && (
        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-ink" />
      )}
    </>
  );

  const shell = "flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left";

  return (
    <li className={`border-b border-line last:border-b-0 ${row.read ? "" : "bg-panel-2"}`}>
      {row.href ? (
        <Link
          href={row.href}
          onClick={() => {
            onNavigate();
            // The destination is server-rendered and may already have been
            // fetched — a comment notification pointing at a post whose thread is
            // in the router cache would show the page without the new comment.
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
