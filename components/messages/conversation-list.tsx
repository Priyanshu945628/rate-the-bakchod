"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ClientConversation, ClientConversationList } from "@/lib/types";
import { Avatar } from "../avatar";
import { PlusIcon, SearchIcon, SpinnerIcon, XIcon } from "../icons";
import { TimeAgo } from "../time-ago";
import { useRealtime } from "../realtime-provider";

/**
 * The thread list.
 *
 * Lives in the messages *layout*, so it is mounted once and survives clicking
 * between threads. That is also why it keeps its own copy of the rows rather than
 * re-reading a server prop: nothing re-renders it from the server while you are in
 * here, so an arriving message has to land in state.
 *
 * Below `lg` this is the whole screen and the open thread replaces it — which is
 * decided from the pathname rather than a prop, because the layout that renders
 * this is a server component and cannot see the route it is wrapping.
 */

const PREVIEW_CHARS = 90;

export function ConversationList({
  initial,
  viewerId,
}: {
  initial: ClientConversationList;
  viewerId: string;
}) {
  const [rows, setRows] = useState<ClientConversation[]>(initial.conversations);
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const pathname = usePathname();

  const activeId = pathname.startsWith("/messages/") ? pathname.slice("/messages/".length) : null;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as ClientConversationList;
      setRows(data.conversations);
    } catch {
      // A dropped refetch is a stale list, not a broken one. The next message, or
      // the next navigation, fixes it.
    }
  }, []);

  useRealtime(
    useCallback(
      (event) => {
        if (event.type !== "message") return;

        setRows((prev) => {
          const at = prev.findIndex((row) => row.id === event.conversationId);
          // A first message from someone new has no row to update. The list has to
          // learn who they are from the server — the event carries a handle but not
          // an avatar or a score.
          if (at === -1) {
            void refetch();
            return prev;
          }

          const mine = event.message.author.id === viewerId;
          const updated: ClientConversation = {
            ...prev[at]!,
            preview: previewOf(event.message.body, event.message.imageUrl),
            lastMessageAt: event.message.createdAt,
            // Not unread if you sent it, and not unread if you are reading it.
            unread: !mine && event.conversationId !== activeId,
          };
          return [updated, ...prev.slice(0, at), ...prev.slice(at + 1)];
        });
      },
      [activeId, refetch, viewerId],
    ),
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.counterpart.displayName.toLowerCase().includes(needle) ||
        row.counterpart.handle.includes(needle),
    );
  }, [rows, query]);

  return (
    <aside
      className={`panel w-full shrink-0 flex-col overflow-hidden lg:flex lg:w-[var(--split-w)] ${
        activeId ? "hidden" : "flex"
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <h1 className="mr-auto text-[15px] font-semibold tracking-tight text-ink">Messages</h1>
        {/* One control for both directions, rather than a `+` here and a Cancel down
            in the form: the row it opens is full width, and it has no room to spare
            for a second way to close itself. */}
        <button
          type="button"
          onClick={() => setComposing((was) => !was)}
          aria-expanded={composing}
          aria-label={composing ? "Cancel new message" : "New message"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border transition-colors ${
            composing
              ? "border-line-strong bg-panel-3 text-ink"
              : "border-line text-muted hover:bg-panel-2 hover:text-ink"
          }`}
        >
          {composing ? <XIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
        </button>
      </header>

      {composing ? <NewThread onOpened={() => setComposing(false)} /> : null}

      <div className="border-b border-line px-3 py-2">
        <label className="flex items-center gap-2 rounded-ctl border border-line bg-panel-2 px-2.5 py-1.5 focus-within:border-line-strong">
          <SearchIcon className="h-4 w-4 shrink-0 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            className="focus-bare w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <li className="px-3.5 py-6 text-center text-xs text-faint">
            {rows.length === 0 ? "No conversations yet." : "Nothing matches."}
          </li>
        ) : (
          shown.map((row) => (
            <li key={row.id}>
              <Row
                row={row}
                active={row.id === activeId}
                unread={row.unread && row.id !== activeId && !readHere.has(row.id)}
                onOpen={() => setReadHere((prev) => new Set(prev).add(row.id))}
              />
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}

function previewOf(body: string | null, imageUrl: string | null): string {
  if (body) {
    return body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body;
  }
  return imageUrl ? "Photo" : "";
}

/**
 * Start a thread by handle.
 *
 * A field rather than a people-picker: the other way in is the Message button on a
 * profile, which is where you already know who you mean. This is for when you
 * remember the @ and not the face.
 *
 * Its own row under the header, not inside it. In the header this shared about 215px
 * with a title, and a field plus a submit plus a cancel does not fit in that — the
 * buttons ended up outside the panel, where `overflow-hidden` cut them in half. The
 * whole width of the list is the smallest space this can honestly ask for, and it is
 * still a narrow pane; opening and closing is the header button's job.
 */
function NewThread({ onOpened }: { onOpened: () => void }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = handle.trim().replace(/^@/, "").toLowerCase();
    if (!target || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: target }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not open that.");
      onOpened();
      router.push(`/messages/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-line px-3 py-2">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@handle"
          aria-label="Handle"
          aria-invalid={error !== null}
          className={`focus-bare min-w-0 flex-1 rounded-ctl border bg-panel-2 px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint ${
            error ? "border-danger" : "border-line focus:border-line-strong"
          }`}
        />
        <button
          type="submit"
          disabled={busy}
          className="flex h-8 shrink-0 items-center rounded-ctl border border-line-strong bg-panel-3 px-3 text-xs font-medium text-ink disabled:opacity-50"
        >
          {busy ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : "Open"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  row,
  active,
  unread,
  onOpen,
}: {
  row: ClientConversation;
  active: boolean;
  unread: boolean;
  onOpen: () => void;
}) {
  return (
    <Link
      href={`/messages/${row.id}`}
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 border-b border-line px-3 py-2.5 transition-colors last:border-b-0 ${
        active ? "bg-panel-3" : "hover:bg-panel-2"
      }`}
    >
      <Avatar src={row.counterpart.avatarUrl} name={row.counterpart.displayName} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[13.5px] ${
              unread ? "font-semibold text-ink" : "font-medium text-ink/90"
            }`}
          >
            {row.counterpart.displayName}
          </span>
          <TimeAgo iso={row.lastMessageAt} className="shrink-0 text-[11px] text-faint" />
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-xs ${unread ? "text-ink/80" : "text-faint"}`}
          >
            {row.preview}
          </span>
          {unread ? (
            <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          ) : null}
        </span>
      </span>
    </Link>
  );
}
