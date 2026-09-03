"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CallKindName,
  ClientCallEntry,
  ClientCounterpart,
  ClientMessage,
  ClientThread,
  ClientThreadEntry,
} from "@/lib/types";
import { limits } from "@/lib/config";
import { Avatar } from "../avatar";
import { useCall } from "../call/call-provider";
import {
  ChevronLeftIcon,
  ClipIcon,
  DoubleCheckIcon,
  CheckIcon,
  PhoneIcon,
  SendIcon,
  SpinnerIcon,
  TrashIcon,
  VideoIcon,
  XIcon,
} from "../icons";
import { ClockTime, TimeAgo, useRecent } from "../time-ago";
import { useRealtime } from "../realtime-provider";

/**
 * One open conversation.
 *
 * Keyed by conversation id at the call site, so switching threads remounts rather
 * than reuses — without that, `useState(initial.entries)` would keep the previous
 * thread's messages on screen under the new person's name.
 *
 * Three things arrive from the stream and each is handled differently: a `message`
 * is appended (deduplicated by id, because the sender gets their own message back
 * down the stream as well as in the POST response), a `read` moves the tick, and a
 * `typing` sets a flag that expires on a timer rather than on another event — the
 * other side stopping typing sends nothing. A finished `call` appends too; the ringing
 * itself is the call provider's business, not this thread's.
 */

/** How long a "typing…" stays up without another ping. */
const TYPING_MS = 4000;

/** One ping per this long, however fast someone types. */
const TYPING_THROTTLE_MS = 3000;

/** Presence window. Inside it, "Active now"; outside, a last-seen stamp. */
const ACTIVE_MS = 120_000;

export function Thread({ initial, viewerId }: { initial: ClientThread; viewerId: string }) {
  const [entries, setEntries] = useState<ClientThreadEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.prevCursor);
  const [theirLastReadAt, setTheirLastReadAt] = useState<string | null>(initial.theirLastReadAt);
  const [typing, setTyping] = useState(false);
  const [older, setOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { id, counterpart, canSend } = initial;

  useRealtime(
    useCallback(
      (event) => {
        if (event.type === "message") {
          if (event.conversationId !== id) return;
          setEntries((prev) =>
            prev.some((e) => e.id === event.message.id)
              ? prev
              : [
                  ...prev,
                  {
                    entry: "message",
                    id: event.message.id,
                    body: event.message.body,
                    imageUrl: event.message.imageUrl,
                    createdAt: event.message.createdAt,
                    deleted: false,
                    mine: event.message.author.id === viewerId,
                    senderId: event.message.author.id,
                  },
                ],
          );
          setTyping(false);
          return;
        }

        if (event.type === "read") {
          if (event.conversationId === id && event.by === counterpart.id) {
            setTheirLastReadAt(event.at);
          }
          return;
        }

        if (event.type === "typing") {
          if (event.conversationId !== id || event.by !== counterpart.id) return;
          setTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), TYPING_MS);
          return;
        }

        // A finished call is a line in this thread. It only rides on `decline` and
        // `end`, which is why there is nothing to append while one is still ringing.
        if (event.type === "call") {
          if (event.conversationId !== id || !event.entry) return;
          const entry = event.entry;
          setEntries((prev) =>
            prev.some((e) => e.id === entry.id) ? prev : [...prev, { entry: "call", ...entry }],
          );
        }
      },
      [id, counterpart.id, viewerId],
    ),
  );

  // Opening the thread is reading it, and so is every message that lands while it
  // is open. Fire-and-forget: the fresh badge counts come back down the stream, so
  // there is nothing here to put in state.
  const lastId = entries.length > 0 ? entries[entries.length - 1]!.id : null;
  useEffect(() => {
    void fetch(`/api/conversations/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(
      () => {},
    );
  }, [id, lastId]);

  // Bottom-anchored, like every chat. Only when something was appended — a
  // prepended page of history keeps its position, handled in `loadOlder`.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  async function loadOlder() {
    if (!cursor || older) return;
    setOlder(true);
    setError(null);

    const box = scroller.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;

    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(id)}/messages?cursor=${encodeURIComponent(cursor)}`,
      );
      const data = (await res.json()) as ClientThread & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load.");

      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...data.entries.filter((e) => !seen.has(e.id)), ...prev];
      });
      setCursor(data.prevCursor);

      // Restore the reading position after the taller list paints, or the thread
      // jumps to the top of the page you just asked for.
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - before;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    } finally {
      setOlder(false);
    }
  }

  function onSent(message: ClientMessage) {
    setEntries((prev) =>
      prev.some((e) => e.id === message.id) ? prev : [...prev, { entry: "message", ...message }],
    );
  }

  function onDeleted(messageId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.entry === "message" && e.id === messageId
          ? { ...e, deleted: true, body: null, imageUrl: null }
          : e,
      ),
    );
  }

  return (
    <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden">
      <Header
        conversationId={id}
        counterpart={counterpart}
        typing={typing}
        canCall={canSend}
        onError={setError}
      />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {cursor ? (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={older}
            className="mx-auto mb-3 flex items-center gap-1.5 rounded-pill border border-line px-3 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            {older ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : null}
            Older
          </button>
        ) : null}

        <ul className="space-y-1.5">
          {entries.map((entry) =>
            entry.entry === "message" ? (
              <Bubble
                key={entry.id}
                conversationId={id}
                message={entry}
                readByThem={isReadByThem(entry, theirLastReadAt)}
                onDeleted={onDeleted}
              />
            ) : (
              <CallRow key={entry.id} entry={entry} />
            ),
          )}
        </ul>
        <div ref={bottom} />
      </div>

      {error ? (
        <p role="alert" className="border-t border-line px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      <Composer conversationId={id} canSend={canSend} onSent={onSent} />
    </section>
  );
}

/** Their tick turns double once their `lastReadAt` passes the message's timestamp. */
function isReadByThem(message: ClientMessage, theirLastReadAt: string | null): boolean {
  if (!message.mine || !theirLastReadAt) return false;
  return theirLastReadAt >= message.createdAt;
}

/**
 * Who you are talking to, and whether they are here.
 *
 * The back chevron exists only below `lg`, where this pane replaced the list. On a
 * wide screen the list is still on the left to click, and a second way back would be
 * a control that does nothing you can't already see how to do.
 *
 * The two call buttons follow `canSend`: the server checks a call against the same
 * policy as a message, so a closed inbox that still offered a phone would be a control
 * that exists only to be refused.
 */
function Header({
  conversationId,
  counterpart,
  typing,
  canCall,
  onError,
}: {
  conversationId: string;
  counterpart: ClientCounterpart;
  typing: boolean;
  canCall: boolean;
  onError: (message: string | null) => void;
}) {
  const active = useRecent(counterpart.lastSeenAt, ACTIVE_MS);
  const { call } = useCall();

  return (
    <header className="flex items-center gap-2 border-b border-line px-2.5 py-2">
      <Link
        href="/messages"
        aria-label="Back to conversations"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink lg:hidden"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </Link>

      <Link
        href={`/u/${counterpart.handle}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ctl px-1 py-0.5 transition-colors hover:bg-panel-2"
      >
        <Avatar src={counterpart.avatarUrl} name={counterpart.displayName} size={36} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold tracking-tight text-ink">
            {counterpart.displayName}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {typing ? (
              "Typing…"
            ) : active ? (
              "Active now"
            ) : counterpart.lastSeenAt ? (
              <>
                Last seen <TimeAgo iso={counterpart.lastSeenAt} />
              </>
            ) : (
              `@${counterpart.handle}`
            )}
          </span>
        </span>
      </Link>

      {canCall ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <CallButton
            conversationId={conversationId}
            kind="VOICE"
            disabled={call !== null}
            onError={onError}
          />
          <CallButton
            conversationId={conversationId}
            kind="VIDEO"
            disabled={call !== null}
            onError={onError}
          />
        </span>
      ) : null}
    </header>
  );
}

/**
 * Ring the other person.
 *
 * Disabled while any call is up rather than hidden, because the reason it cannot be
 * pressed is temporary and a control that vanishes mid-conversation reads as a feature
 * being taken away.
 *
 * Failures come back as a message from `start` instead of a thrown error, and land in
 * the thread's own error line — the same place a rejected send appears, because from
 * where the reader sits they are the same kind of "that did not go".
 */
function CallButton({
  conversationId,
  kind,
  disabled,
  onError,
}: {
  conversationId: string;
  kind: CallKindName;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const { start } = useCall();
  const [busy, setBusy] = useState(false);
  const Icon = kind === "VIDEO" ? VideoIcon : PhoneIcon;

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label={kind === "VIDEO" ? "Video call" : "Voice call"}
      onClick={() => {
        onError(null);
        setBusy(true);
        void start(conversationId, kind).then((message) => {
          setBusy(false);
          if (message) onError(message);
        });
      }}
      className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * A call in the timeline.
 *
 * Centred rather than sided: a call is not something one person said, so `direction`
 * is a word inside the row instead of the edge the row sits against.
 */
function CallRow({ entry }: { entry: ClientCallEntry }) {
  const Icon = entry.kind === "VIDEO" ? VideoIcon : PhoneIcon;
  const bad =
    entry.status === "MISSED" || entry.status === "DECLINED" || entry.status === "FAILED";

  return (
    <li className="flex justify-center py-1">
      <span
        className={`flex items-center gap-1.5 rounded-pill border border-line bg-panel-2 px-2.5 py-1 text-[11px] ${
          bad ? "text-danger" : "text-muted"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {callLabel(entry)}
        <ClockTime iso={entry.createdAt} className="text-faint" />
      </span>
    </li>
  );
}

function callLabel(entry: ClientCallEntry): string {
  const kind = entry.kind === "VIDEO" ? "Video call" : "Voice call";
  switch (entry.status) {
    case "RINGING":
      return `${kind} ringing`;
    case "ACCEPTED":
      return `${kind} in progress`;
    case "DECLINED":
      return `${kind} declined`;
    case "FAILED":
      return `${kind} failed`;
    case "MISSED":
      return entry.direction === "out" ? `${kind} · no answer` : `Missed ${kind.toLowerCase()}`;
    case "ENDED":
      return entry.durationMs !== null
        ? `${kind} · ${duration(entry.durationMs)}`
        : `${kind} ended`;
  }
}

function duration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * One message.
 *
 * Delete is offered on your own bubbles only, and it clears the content on both sides —
 * but the row stays. A thread that reflowed under the other person mid-read would move
 * the line they were on.
 */
function Bubble({
  conversationId,
  message,
  readByThem,
  onDeleted,
}: {
  conversationId: string;
  message: ClientMessage;
  readByThem: boolean;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: message.id }),
        },
      );
      if (res.ok) onDeleted(message.id);
    } catch {
      // The bubble is still on screen and the control is still there, so a failure
      // needs no line of its own — pressing it again retries.
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
      <div className="group flex max-w-[80%] items-end gap-1">
        {message.mine && !message.deleted ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Delete message"
            className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            {busy ? (
              <SpinnerIcon className="h-3 w-3 animate-spin" />
            ) : (
              <TrashIcon className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}

        <div
          className={`min-w-0 rounded-card border px-2.5 py-1.5 ${
            message.mine ? "border-line-strong bg-panel-3" : "border-line bg-panel-2"
          }`}
        >
          {message.deleted ? (
            <p className="text-[12.5px] italic text-faint">Message deleted</p>
          ) : (
            <>
              {message.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={message.imageUrl}
                  alt=""
                  className="mb-1 max-h-[320px] w-auto rounded-ctl border border-line"
                />
              ) : null}
              {message.body ? (
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">
                  {message.body}
                </p>
              ) : null}
            </>
          )}

          <span className="mt-0.5 flex items-center justify-end gap-1">
            <ClockTime iso={message.createdAt} className="text-[10px] text-faint" />
            {message.mine && !message.deleted ? (
              readByThem ? (
                <span role="img" aria-label="Read" className="flex">
                  <DoubleCheckIcon className="h-3 w-3 text-accent" />
                </span>
              ) : (
                <span role="img" aria-label="Sent" className="flex">
                  <CheckIcon className="h-3 w-3 text-faint" />
                </span>
              )
            ) : null}
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * The composer.
 *
 * An image is uploaded the moment it is picked rather than on send, so the two-step
 * write the API expects — bytes first, then a message that names the key — happens
 * while you are still typing the line that goes with it. The key is single-use
 * server-side, so a preview that never gets sent leaves an orphan row and no message,
 * which is the harmless direction for that to fail in.
 */
function Composer({
  conversationId,
  canSend,
  onSent,
}: {
  conversationId: string;
  canSend: boolean;
  onSent: (message: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const pinged = useRef(0);

  const ready = (draft.trim().length > 0 || attachment !== null) && !busy && !uploading;

  function ping() {
    const now = Date.now();
    if (now - pinged.current < TYPING_THROTTLE_MS) return;
    pinged.current = now;
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/typing`, {
      method: "POST",
    }).catch(() => {});
  }

  async function pick(chosen: File) {
    if (chosen.size > limits.dmImageUploadMaxBytes) {
      setError("That image is too large.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", chosen);
      const res = await fetch("/api/message-asset", { method: "POST", body: form });
      const data = (await res.json()) as {
        asset?: { key: string; url: string };
        error?: string;
      };
      if (!res.ok || !data.asset) throw new Error(data.error ?? "Could not attach that.");
      setAttachment({ key: data.asset.key, url: data.asset.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach that.");
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: draft.trim() || null,
            attachmentKey: attachment?.key ?? null,
          }),
        },
      );
      const data = (await res.json()) as { message?: ClientMessage; error?: string };
      if (!res.ok || !data.message) throw new Error(data.error ?? "Could not send.");

      onSent(data.message);
      setDraft("");
      setAttachment(null);
      pinged.current = 0;
      if (box.current) box.current.style.height = "auto";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  if (!canSend) {
    return (
      <p className="border-t border-line px-3 py-3 text-center text-[12px] text-faint">
        They are not accepting messages.
      </p>
    );
  }

  return (
    <div className="border-t border-line px-2.5 py-2">
      {error ? (
        <p role="alert" className="mb-1.5 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      {attachment ? (
        <div className="relative mb-1.5 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.url}
            alt=""
            className="max-h-[120px] w-auto rounded-ctl border border-line"
          />
          <button
            type="button"
            onClick={() => setAttachment(null)}
            aria-label="Remove image"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel-3 text-muted transition-colors hover:text-ink"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            // Cleared so that picking the same file twice fires a second change.
            e.target.value = "";
            if (chosen) void pick(chosen);
          }}
        />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={uploading || attachment !== null}
          aria-label="Attach image"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          {uploading ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <ClipIcon className="h-4 w-4" />
          )}
        </button>

        <textarea
          ref={box}
          rows={1}
          value={draft}
          maxLength={limits.messageMaxLength}
          onChange={(e) => {
            setDraft(e.target.value);
            ping();
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the chat convention, and the
            // reason this is a textarea rather than an input in the first place.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message"
          aria-label="Message"
          className="focus-bare max-h-[120px] min-h-[36px] w-full resize-none rounded-ctl border border-line bg-panel-2 px-2.5 py-2 text-[13.5px] leading-snug text-ink outline-none placeholder:text-faint focus:border-line-strong"
        />

        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line-strong bg-panel-3 text-ink disabled:opacity-40"
        >
          {busy ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SendIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {draft.length > limits.messageMaxLength - 200 ? (
        <p className="mt-1 text-right text-[10px] text-faint">
          {limits.messageMaxLength - draft.length}
        </p>
      ) : null}
    </div>
  );
}
