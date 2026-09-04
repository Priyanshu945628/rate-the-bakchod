"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CallKindName,
  ClientCallEntry,
  ClientCounterpart,
  ClientMessage,
  ClientReplyRef,
  ClientThread,
  ClientThreadEntry,
} from "@/lib/types";
import { limits } from "@/lib/config";
import { ActionMenu, type MenuAction } from "../action-menu";
import { Avatar } from "../avatar";
import { useCall } from "../call/call-provider";
import {
  CheckIcon,
  ChevronLeftIcon,
  ClipIcon,
  CopyIcon,
  DoubleCheckIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ReplyIcon,
  SendIcon,
  SmileIcon,
  SpinnerIcon,
  TrashIcon,
  VerifiedIcon,
  VideoIcon,
  XIcon,
} from "../icons";
import { ClockTime, DayLabel, TimeAgo, useRecent, utcDay } from "../time-ago";
import { useDismiss } from "../use-dismiss";
import { useRealtime } from "../realtime-provider";
import { ViewableImage } from "../photo-viewer";
import { LinkCard } from "./link-card";
import { Linkified } from "./linkify";
import {
  ORIGINAL,
  PHOTO_FILTERS,
  filterCss,
  renderPhoto,
  supportsFilters,
} from "../photo-filters";

/**
 * One open conversation.
 *
 * Keyed by conversation id at the call site, so switching threads remounts rather
 * than reuses — without that, `useState(initial.entries)` would keep the previous
 * thread's messages on screen under the new person's name.
 *
 * Four things arrive from the stream and each is handled differently: a `message`
 * is appended (deduplicated by id, because the sender gets their own message back
 * down the stream as well as in the POST response), a `message-update` patches one
 * entry in place — an edit or an unsend, from either end — a `read` moves the tick,
 * and a `typing` sets a flag that expires on a timer rather than on another event:
 * the other side stopping typing sends nothing. A finished `call` appends too; the
 * ringing itself is the call provider's business, not this thread's.
 *
 * This is also the one surface in the app that gets gradients — see the `chat-*`
 * block at the bottom of `app/globals.css` for why, and for the promise that it
 * stops here.
 *
 * `chat-full` on the section below is not a look, it is a claim: *a thread is open*.
 * Below `lg` that hides the site's top bar and tab bar and drops the page's gutters,
 * so a conversation on a phone is the whole screen and the header's back arrow is the
 * only way out of it.
 */

/** How long a "typing…" stays up without another ping. */
const TYPING_MS = 4000;

/** One ping per this long, however fast someone types. */
const TYPING_THROTTLE_MS = 3000;

/** Presence window. Inside it, "Active now"; outside, a last-seen stamp. */
const ACTIVE_MS = 120_000;

/** How long the ring stays on a message you were sent back to. */
const FLASH_MS = 1200;

/** Their avatar's width, and the gutter reserved for it further down a run. */
const THEIR_AVATAR = 28;

/** One entry's worth of a patch — an edit or an unsend, whichever end it came from. */
interface MessagePatch {
  messageId: string;
  body: string | null;
  editedAt: string | null;
  deleted: boolean;
}

export function Thread({ initial, viewerId }: { initial: ClientThread; viewerId: string }) {
  const [entries, setEntries] = useState<ClientThreadEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.prevCursor);
  const [theirLastReadAt, setTheirLastReadAt] = useState<string | null>(initial.theirLastReadAt);
  const [typing, setTyping] = useState(false);
  const [older, setOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ClientMessage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { id, counterpart, canSend } = initial;

  /**
   * One message changed. Applied identically whether it came from the stream or from
   * this tab's own request, so an edit looks the same to the person who made it.
   */
  const applyPatch = useCallback((patch: MessagePatch) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.entry !== "message") return e;
        if (e.id === patch.messageId) {
          return {
            ...e,
            body: patch.body,
            imageUrl: patch.deleted ? null : e.imageUrl,
            editedAt: patch.editedAt,
            deleted: patch.deleted,
          };
        }
        // A reply quoting a message that has just been unsent loses the quote as
        // well, or the thread keeps a copy of the words the tombstone replaced —
        // the same reason the server strips them in `toReplyRef`. An *edit* is left
        // alone on purpose: you answered what was said at the time.
        if (patch.deleted && e.replyTo?.id === patch.messageId) {
          return { ...e, replyTo: { ...e.replyTo, excerpt: null, hasImage: false, deleted: true } };
        }
        return e;
      }),
    );
  }, []);

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
                    // A message cannot arrive already edited: an edit is a
                    // `message-update`, and this is the frame that announces the
                    // first version of it.
                    editedAt: null,
                    deleted: false,
                    mine: event.message.author.id === viewerId,
                    senderId: event.message.author.id,
                    replyTo: event.message.replyTo,
                  },
                ],
          );
          setTyping(false);
          return;
        }

        if (event.type === "message-update") {
          if (event.conversationId !== id) return;
          applyPatch(event);
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
      [id, counterpart.id, viewerId, applyPatch],
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

  // The typing bubble gets the same treatment, but only from near the bottom. It
  // comes and goes on a 4s timer, and yanking somebody out of the history they were
  // reading every four seconds is worse than not seeing the dots.
  useEffect(() => {
    if (!typing) return;
    const box = scroller.current;
    if (!box || box.scrollHeight - box.scrollTop - box.clientHeight > 120) return;
    bottom.current?.scrollIntoView({ block: "end" });
  }, [typing]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  /**
   * Scroll to the message a quote points at, and ring it once it is there.
   *
   * Only works for what is on screen: the thread pages backwards on demand, so a
   * reply to something from last week quotes a message this component has never
   * loaded. Rather than fetch pages until it turns up — which could be a lot of
   * pages — say so and leave the reader where they are.
   */
  function jumpTo(messageId: string) {
    const target = document.getElementById(`msg-${messageId}`);
    if (!target) {
      setError("That message is not loaded yet.");
      return;
    }
    setError(null);
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(messageId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }

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
    setReplyTo(null);
  }

  return (
    <section className="chat-full panel chat-glow flex min-w-0 flex-1 flex-col overflow-hidden">
      <Header
        conversationId={id}
        counterpart={counterpart}
        typing={typing}
        canCall={canSend}
        onError={setError}
      />
      {/* `overflow-x-hidden` as well as the fixes on the bubbles themselves: a
          scroll container cannot have `overflow-y: auto` and `overflow-x: visible`,
          so anything wide in here would otherwise put a horizontal scrollbar across
          the whole thread. Nothing in a bubble is meant to be scrolled sideways. */}
      <div
        ref={scroller}
        data-menu-bounds
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
      >
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
        <ul className="space-y-1">
          {entries.map((entry, index) => (
            <ThreadRow
              key={entry.id}
              conversationId={id}
              entry={entry}
              previous={index > 0 ? entries[index - 1]! : null}
              counterpart={counterpart}
              theirLastReadAt={theirLastReadAt}
              flash={flash}
              onPatch={applyPatch}
              onReply={setReplyTo}
              onJump={jumpTo}
              onError={setError}
            />
          ))}
          {typing ? <TypingBubble counterpart={counterpart} /> : null}
        </ul>
        <div ref={bottom} />
      </div>
      {error ? (
        <p role="alert" className="border-t border-line px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
      <Composer
        conversationId={id}
        canSend={canSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={onSent}
      />
    </section>
  );
}

/**
 * One line of the thread, and the day divider that may sit above it.
 *
 * Both facts a row needs — whether the day changed, and whether this is the first
 * bubble of a run by one person — come from the same glance at the entry before it,
 * so they are decided together here rather than in a pass over `entries` first.
 */
function ThreadRow({
  conversationId,
  entry,
  previous,
  counterpart,
  theirLastReadAt,
  flash,
  onPatch,
  onReply,
  onJump,
  onError,
}: {
  conversationId: string;
  entry: ClientThreadEntry;
  previous: ClientThreadEntry | null;
  counterpart: ClientCounterpart;
  theirLastReadAt: string | null;
  flash: string | null;
  onPatch: (patch: MessagePatch) => void;
  onReply: (message: ClientMessage) => void;
  onJump: (messageId: string) => void;
  onError: (message: string | null) => void;
}) {
  const newDay = !previous || utcDay(previous.createdAt) !== utcDay(entry.createdAt);
  // A new day, a different speaker, or a call line in between all break the run.
  const sameRun =
    !newDay &&
    entry.entry === "message" &&
    previous?.entry === "message" &&
    previous.senderId === entry.senderId;

  return (
    <Fragment>
      {newDay ? <DayDivider iso={entry.createdAt} /> : null}
      {entry.entry === "call" ? (
        <CallRow entry={entry} />
      ) : (
        <Bubble
          conversationId={conversationId}
          message={entry}
          counterpart={counterpart}
          runStart={!sameRun}
          read={isReadByThem(entry, theirLastReadAt)}
          flash={flash === entry.id}
          onPatch={onPatch}
          onReply={onReply}
          onJump={onJump}
          onError={onError}
        />
      )}
    </Fragment>
  );
}

/** The date pill between two days of conversation. */
function DayDivider({ iso }: { iso: string }) {
  return (
    <li className="flex justify-center py-2">
      <DayLabel
        iso={iso}
        className="chat-pill rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted"
      />
    </li>
  );
}

/** Their tick turns double once their `lastReadAt` passes the message's timestamp. */
function isReadByThem(message: ClientMessage, theirLastReadAt: string | null): boolean {
  if (!message.mine || !theirLastReadAt) return false;
  return theirLastReadAt >= message.createdAt;
}

/**
 * One message.
 *
 * The bubble sits against its own side and the ⋯ beside it, on the inner edge in
 * both directions: the free space in a chat row is always toward the middle, and a
 * control pressed against the panel's edge is one you have to aim at.
 *
 * The ⋯ is centred against the *bubble* rather than the row, which is why it lives
 * inside the column next to the bubble instead of beside it as a third child of the
 * `<li>`. The row is bubble plus timestamp, so centring on the row leaves the button
 * hanging low — noticeably so against a photo, where the bubble is tall and the ⋯
 * ended up level with the last line of chrome underneath it.
 *
 * The `id` is on the `<li>`, not the bubble, because `jumpTo` scrolls to a whole row
 * and `chat-flash` is what then says which one it landed on.
 */
function Bubble({
  conversationId,
  message,
  counterpart,
  runStart,
  read,
  flash,
  onPatch,
  onReply,
  onJump,
  onError,
}: {
  conversationId: string;
  message: ClientMessage;
  counterpart: ClientCounterpart;
  runStart: boolean;
  read: boolean;
  flash: boolean;
  onPatch: (patch: MessagePatch) => void;
  onReply: (message: ClientMessage) => void;
  onJump: (messageId: string) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body ?? "");
  const [busy, setBusy] = useState(false);

  const { mine, deleted, body, imageUrl } = message;
  const endpoint = `/api/conversations/${encodeURIComponent(conversationId)}/messages`;

  /** Save an edit. The patch is applied from the server's copy, never from the draft. */
  async function save() {
    const next = draft.trim();
    if (!next || next === (body ?? "")) {
      setEditing(false);
      setDraft(body ?? "");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: message.id, body: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: ClientMessage;
        error?: string;
      };
      if (!res.ok || !data.message) throw new Error(data.error ?? "Could not save.");
      onPatch({
        messageId: data.message.id,
        body: data.message.body,
        editedAt: data.message.editedAt,
        deleted: data.message.deleted,
      });
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Unsend. The local patch is the same one the stream carries to the other end —
   * `editedAt: null` included, because a tombstone has nothing left to have edited.
   */
  async function unsend() {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: message.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not unsend.");
      }
      onPatch({ messageId: message.id, body: null, editedAt: null, deleted: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not unsend.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      onError(null);
    } catch {
      // Denied permission, or an insecure origin. Nothing to retry, so say so once.
      onError("Could not copy.");
    }
  }

  /**
   * What the ⋯ offers.
   *
   * Reply and Copy are anyone's; Edit and Unsend are only ever your own words. A
   * message that has been unsent gets no menu at all — there is nothing left to
   * reply to, copy, or delete twice.
   */
  const actions: MenuAction[] = [];
  if (!deleted) {
    actions.push({ label: "Reply", icon: ReplyIcon, run: () => onReply(message) });
    if (body) actions.push({ label: "Copy", icon: CopyIcon, run: () => void copy() });
    if (mine && body) {
      actions.push({
        label: "Edit",
        icon: PencilIcon,
        run: () => {
          setDraft(body);
          setEditing(true);
        },
      });
    }
    if (mine) {
      actions.push({ label: "Unsend", icon: TrashIcon, run: () => void unsend(), danger: true });
    }
  }

  // Yours hangs from the trigger's left edge and theirs from its right, so in both
  // cases the panel opens across the bubble rather than off the side of the thread.
  const menu = (
    <ActionMenu
      label="Message options"
      actions={actions}
      align={mine ? "start" : "end"}
      size="sm"
      disabled={busy}
    />
  );

  return (
    <li
      id={`msg-${message.id}`}
      className={`flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
    >
      {mine ? null : runStart ? (
        <Avatar
          src={counterpart.avatarUrl}
          name={counterpart.displayName}
          size={THEIR_AVATAR}
          isAI={counterpart.isAI}
        />
      ) : (
        // The gutter their avatar would have taken, so a run stays in one column.
        <span aria-hidden className="shrink-0" style={{ width: THEIR_AVATAR }} />
      )}

      <div className="flex min-w-0 max-w-[min(78%,30rem)] flex-col gap-1">
        <div
          className={`flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
        >
          {mine ? menu : null}

          <div
            className={`min-w-0 overflow-hidden rounded-card px-3 py-2 ${
              mine ? "chat-mine" : "chat-theirs"
            } ${flash ? "chat-flash" : ""}`}
          >
            {message.replyTo ? (
              <Quote reply={message.replyTo} mine={mine} onJump={onJump} />
            ) : null}

            {imageUrl ? (
              <ViewableImage
                src={imageUrl}
                alt=""
                className={`max-h-[280px] w-auto rounded-ctl ${
                  body || editing ? "mb-1.5" : ""
                }`}
              />
            ) : null}

            {editing ? (
              <EditBox
                draft={draft}
                busy={busy}
                onChange={setDraft}
                onCancel={() => {
                  setEditing(false);
                  setDraft(body ?? "");
                }}
                onSave={() => void save()}
              />
            ) : deleted ? (
              <p className="text-[13px] italic text-faint">Unsent</p>
            ) : body ? (
              <>
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink">
                  <Linkified text={body} />
                </p>
                {/* Renders nothing unless the body has a link and that link had
                    something to say, so every other message pays one regex for it. */}
                <LinkCard text={body} />
              </>
            ) : null}
          </div>

          {mine ? null : menu}
        </div>

        <div
          className={`flex items-center gap-1 px-1 text-[10px] text-faint ${
            mine ? "justify-end" : "justify-start"
          }`}
        >
          <ClockTime iso={message.createdAt} />
          {message.editedAt && !deleted ? <span>· edited</span> : null}
          {mine && !deleted ? (
            read ? (
              <DoubleCheckIcon className="h-3 w-3 text-chat" />
            ) : (
              <CheckIcon className="h-3 w-3" />
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Rewriting a message in place.
 *
 * Enter saves and Escape cancels, the same keys the composer below uses, because two
 * text boxes on one screen that answer the same keys differently is a trap. The
 * buttons stay for anyone who is not reaching for the keyboard.
 */
function EditBox({
  draft,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: string;
  busy: boolean;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={draft}
        autoFocus
        rows={2}
        maxLength={limits.messageMaxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave();
          }
        }}
        className="focus-bare max-h-[160px] min-h-[46px] w-full resize-none rounded-ctl border border-line-strong bg-panel px-2 py-1.5 text-[13.5px] leading-snug text-ink outline-none"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-pill px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || draft.trim().length === 0}
          className="flex items-center gap-1 rounded-pill bg-chat px-2.5 py-0.5 text-[11px] font-semibold text-chat-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * The quoted line at the top of a reply.
 *
 * A button rather than a blockquote, because it goes somewhere: it scrolls the thread
 * to what was quoted. The excerpt arrives flattened and truncated from the server, so
 * a quote of a twelve-line message is one clamped line here — and a quote of
 * something since unsent arrives with no words at all, which is the point.
 */
function Quote({
  reply,
  mine,
  onJump,
}: {
  reply: ClientReplyRef;
  mine: boolean;
  onJump: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(reply.id)}
      className={`mb-1.5 flex w-full items-center gap-1.5 rounded-ctl border-l-2 bg-panel/60 px-2 py-1 text-left text-[11.5px] transition-colors hover:bg-panel ${
        mine ? "border-chat" : "border-line-strong"
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-muted">
        {reply.deleted ? (
          <span className="italic text-faint">Unsent</span>
        ) : (
          (reply.excerpt ?? (reply.hasImage ? "Photo" : "Message"))
        )}
      </span>
      {reply.hasImage && !reply.deleted ? (
        <ClipIcon className="h-3 w-3 shrink-0 text-faint" />
      ) : null}
    </button>
  );
}

/**
 * Who you are talking to, and what they are doing.
 *
 * The dot on the avatar and the line under the name are one fact drawn twice — a
 * glance and a read — and both come from `useRecent`, whose server snapshot is
 * `false`, so the two renders cannot disagree across hydration.
 *
 * No ring around the picture. A lit ring around a round avatar already means *there is
 * a story in there* on the profile and in the feed's tray, and borrowing it here to
 * mean nothing at all would cost it that meaning everywhere else. The whole block is a
 * link to the profile and is shaded on hover to say so.
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink lg:hidden"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </Link>

      <Link
        href={`/u/${encodeURIComponent(counterpart.handle)}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-ctl px-1 py-0.5 transition-colors hover:bg-panel-2"
      >
        <span className="relative shrink-0">
          <Avatar
            src={counterpart.avatarUrl}
            name={counterpart.displayName}
            size={36}
            isAI={counterpart.isAI}
          />
          {active ? (
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-pill border-2 border-panel bg-chat" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-[13.5px] font-semibold tracking-tight text-ink">
              {counterpart.displayName}
            </span>
            {counterpart.isAI ? (
              <VerifiedIcon className="h-3.5 w-3.5 shrink-0 text-chat" />
            ) : null}
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

/** Place a call. Whatever the provider refuses with goes to the thread's error line. */
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
      aria-label={kind === "VIDEO" ? "Video call" : "Voice call"}
      disabled={disabled || busy}
      onClick={() => {
        onError(null);
        setBusy(true);
        void start(conversationId, kind).then((message) => {
          setBusy(false);
          if (message) onError(message);
        });
      }}
      className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/** A finished call, as a line in the thread. Centred, because it is nobody's message. */
function CallRow({ entry }: { entry: ClientCallEntry }) {
  const bad =
    entry.status === "MISSED" || entry.status === "DECLINED" || entry.status === "FAILED";
  const Icon = entry.kind === "VIDEO" ? VideoIcon : PhoneIcon;

  return (
    <li className="flex justify-center py-1">
      <span
        className={`chat-pill flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] ${
          bad ? "text-danger" : "text-muted"
        }`}
      >
        <Icon className="h-3 w-3 shrink-0" />
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
      return entry.durationMs !== null ? `${kind} · ${duration(entry.durationMs)}` : `${kind} ended`;
  }
}

function duration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The three dots, in the gutter their bubbles use, so it lines up under them. */
function TypingBubble({ counterpart }: { counterpart: ClientCounterpart }) {
  return (
    <li className="flex items-end gap-1.5">
      <Avatar
        src={counterpart.avatarUrl}
        name={counterpart.displayName}
        size={THEIR_AVATAR}
        isAI={counterpart.isAI}
      />
      <span
        role="status"
        aria-label="Typing"
        className="chat-theirs flex items-center gap-1 rounded-card px-3 py-2.5"
      >
        {[-1.2, -1, -0.8].map((delay) => (
          <span
            key={delay}
            className="typing-dot h-1.5 w-1.5 rounded-pill bg-muted"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </li>
  );
}

/**
 * The tray behind the smiley. A fixed two dozen, not a picker.
 *
 * Every one of these is something people actually send in a group chat here; a full
 * Unicode picker is a searchable database, a scroll area and a font problem, and none
 * of that belongs in a bundle for a control used to add 🔥 to a sentence.
 */
const EMOJI = [
  "😂", "🤣", "😭", "💀", "🔥", "👍", "🙏", "❤️",
  "😅", "😳", "🤡", "👀", "🤝", "💯", "🥲", "😤",
  "🫡", "🤌", "🤔", "😮", "🎉", "😈", "🙈", "✨",
];

/**
 * The pill.
 *
 * `+` attaches an image, the smiley opens the tray above, and the blue circle sends.
 * A picture can also be pasted straight in — a screenshot is the most common thing
 * anybody has to hand, and reaching for a file dialog to send one is a step that only
 * exists because nobody wired the paste up.
 *
 * There is no microphone: DMs carry text and images, and a button that cannot record
 * is a promise the app does not keep.
 */
function Composer({
  conversationId,
  canSend,
  replyTo,
  onCancelReply,
  onSent,
}: {
  conversationId: string;
  canSend: boolean;
  replyTo: ClientMessage | null;
  onCancelReply: () => void;
  onSent: (message: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  /** The picked file and a local URL for it. Nothing is uploaded until Send. */
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [filter, setFilter] = useState(ORIGINAL);
  const [filters, setFilters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tray, setTray] = useState(false);

  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const trayWrap = useRef<HTMLDivElement>(null);
  /** When the last typing ping went out, so one keystroke in three does not send one. */
  const pinged = useRef(0);

  useDismiss(
    tray,
    trayWrap,
    useCallback(() => setTray(false), []),
  );

  // One live URL at a time. The cleanup runs before the next photo's effect and on
  // unmount, so the object URL of a photo that was replaced or sent is always released.
  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.url]);

  // Pressing Reply on a bubble should put the caret where the reply gets written.
  useEffect(() => {
    if (replyTo) box.current?.focus();
  }, [replyTo]);

  const css = filterCss(filter);
  const ready = (draft.trim().length > 0 || photo !== null) && !busy;

  /** One ping per `TYPING_THROTTLE_MS`, however fast the keys come. */
  function ping() {
    const now = Date.now();
    if (now - pinged.current < TYPING_THROTTLE_MS) return;
    pinged.current = now;
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/typing`, {
      method: "POST",
    }).catch(() => {});
  }

  /**
   * Take a picked or pasted file.
   *
   * Held here rather than uploaded on the spot, which is what the old flow did: the
   * filter has to be settled before the pixels are drawn, and drawing them *is* the
   * upload. So the size check is the only thing that happens now, and it happens
   * against the raw file — the one number the user can do anything about.
   */
  function pick(chosen: File) {
    if (!chosen.type.startsWith("image/")) {
      setError("Images only.");
      return;
    }
    if (chosen.size > limits.dmImageUploadMaxBytes) {
      setError(`Images max ${Math.round(limits.dmImageUploadMaxBytes / (1024 * 1024))}MB.`);
      return;
    }
    setError(null);
    // Probed here rather than in an effect. This is the first moment a strip could be
    // shown at all, and it is unambiguously a moment on the client — so the server
    // render never has an opinion about it to disagree with.
    setFilters(supportsFilters());
    setFilter(ORIGINAL);
    setPhoto({ file: chosen, url: URL.createObjectURL(chosen) });
  }

  async function send() {
    const text = draft.trim();
    if (!text && !photo) return;
    setBusy(true);
    setError(null);
    try {
      let attachmentKey: string | null = null;
      if (photo) {
        const rendered = await renderPhoto(photo.file, css, {
          maxEdge: limits.dmImageMaxEdge,
          uploadMaxBytes: limits.dmImageUploadMaxBytes,
        });
        const form = new FormData();
        form.append("file", rendered);
        const res = await fetch("/api/message-asset", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          asset?: { key: string; url: string };
          error?: string;
        };
        if (!res.ok || !data.asset) throw new Error(data.error ?? "Could not upload.");
        attachmentKey = data.asset.key;
      }

      const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: text || null,
          attachmentKey,
          replyToId: replyTo?.id ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: ClientMessage;
        error?: string;
      };
      if (!res.ok || !data.message) throw new Error(data.error ?? "Could not send.");
      onSent(data.message);
      setDraft("");
      setPhoto(null);
      setFilter(ORIGINAL);
      setTray(false);
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
    <div className="border-t border-line px-3 pb-3 pt-2">
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-ctl border border-line bg-panel-2 px-2.5 py-1.5">
          <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-chat" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
            {replyTo.body ?? (replyTo.imageUrl ? "Photo" : "Message")}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctl text-faint transition-colors hover:bg-panel-3 hover:text-ink"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {photo ? (
        <div className="mb-2 rounded-ctl border border-line bg-panel-2 p-2">
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt=""
              style={{ filter: css || undefined }}
              className="max-h-[150px] rounded-ctl"
            />
            <button
              type="button"
              onClick={() => setPhoto(null)}
              disabled={busy}
              aria-label="Remove image"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-pill bg-bg/80 text-ink transition-colors hover:bg-bg"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Each swatch is the same object URL under a different filter — one decode,
              eight looks, and no second copy of the photo to keep in step with it. */}
          {filters ? (
            <ul className="no-bar mt-2 flex gap-1.5 overflow-x-auto">
              {PHOTO_FILTERS.map((preset) => {
                const on = preset.id === filter;
                return (
                  <li key={preset.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setFilter(preset.id)}
                      // Locked once Send has started: the pixels were already drawn
                      // through whichever filter was chosen then, and a strip that
                      // could still move would be showing a photo nobody is sending.
                      disabled={busy}
                      aria-pressed={on}
                      className={`flex w-[46px] flex-col items-center gap-1 rounded-ctl p-[3px] transition-colors ${
                        on ? "bg-chat/15" : "hover:bg-panel-3"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt=""
                        style={{ filter: preset.css || undefined }}
                        className={`h-10 w-10 rounded-ctl border object-cover ${
                          on ? "border-chat" : "border-line-strong"
                        }`}
                      />
                      <span
                        className={`text-[9px] leading-none ${on ? "text-chat" : "text-faint"}`}
                      >
                        {preset.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="chat-pill flex items-end gap-1 rounded-[22px] p-1.5">
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            // Cleared so picking the same file twice still fires a change.
            e.target.value = "";
            if (chosen) pick(chosen);
          }}
        />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={busy}
          aria-label="Attach an image"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-muted transition-colors hover:bg-panel-3 hover:text-ink disabled:opacity-40"
        >
          <PlusIcon className="h-4 w-4" />
        </button>

        <div ref={trayWrap} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setTray((v) => !v)}
            aria-expanded={tray}
            aria-label="Emoji"
            className="flex h-8 w-8 items-center justify-center rounded-pill text-muted transition-colors hover:bg-panel-3 hover:text-ink"
          >
            <SmileIcon className="h-4 w-4" />
          </button>
          {tray ? (
            <div className="panel absolute bottom-full left-0 z-30 mb-2 grid w-[232px] grid-cols-8 gap-0.5 p-1.5 shadow-pop">
              {EMOJI.map((glyph) => (
                <button
                  key={glyph}
                  type="button"
                  onClick={() => {
                    setDraft((current) => current + glyph);
                    setTray(false);
                    box.current?.focus();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-ctl text-[15px] transition-colors hover:bg-panel-3"
                >
                  {glyph}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <textarea
          ref={box}
          rows={1}
          value={draft}
          maxLength={limits.messageMaxLength}
          placeholder="Message"
          onChange={(e) => {
            setDraft(e.target.value);
            // Reset first: a shrinking textarea keeps the old scrollHeight otherwise.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            ping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (ready) void send();
            }
          }}
          onPaste={(e) => {
            // A copied photo arrives as a file beside no text at all. When there is
            // text too, the paste is text: a spreadsheet cell and a chunk of a web page
            // both bring a picture of themselves along, and nobody means to send that.
            if (e.clipboardData.getData("text/plain")) return;
            const image = Array.from(e.clipboardData.files).find((item) =>
              item.type.startsWith("image/"),
            );
            if (!image) return;
            e.preventDefault();
            pick(image);
          }}
          className="focus-bare max-h-[120px] min-h-[32px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] leading-snug text-ink placeholder:text-faint"
        />

        {draft.length > limits.messageMaxLength - 200 ? (
          <span className="shrink-0 self-center px-1 text-[10px] tabular-nums text-faint">
            {limits.messageMaxLength - draft.length}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-chat text-chat-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SendIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-1.5 px-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
