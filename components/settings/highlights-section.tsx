"use client";

import { useRef, useState } from "react";
import { limits } from "@/lib/config";
import type { ClientHighlight, ClientStory } from "@/lib/types";
import { Section } from "./fields";
import { PlusIcon, SpinnerIcon, TrashIcon } from "../icons";

/**
 * Highlights and the story archive.
 *
 * This section does not go through the theme draft — highlights are their own rows
 * and every action here is a write on its own. So it saves as you go, and re-reads
 * the whole lot afterwards rather than trying to patch two lists in place: the
 * counts, the live flags and which highlight a story belongs to all move together,
 * and one GET is cheaper than the bugs.
 *
 * The archive is the counterpart to expiry being non-destructive. A story that has
 * expired is still here, still yours, and can still be promoted into a highlight —
 * which is exactly why nothing is deleted on a timer. Deleting one *here* is the
 * real thing: the key is shredded and the media stops decrypting.
 */

export interface ArchiveItem {
  story: ClientStory;
  live: boolean;
  highlight: { id: string; title: string } | null;
}

type Action =
  | { action: "create"; title: string }
  | { action: "rename"; id: string; title: string }
  | { action: "delete"; id: string }
  | { action: "setCover"; id: string; assetKey: string }
  | { action: "add"; id: string; postId: string }
  | { action: "remove"; postId: string };

export function HighlightsSection({
  initialHighlights,
  initialArchive,
}: {
  initialHighlights: ClientHighlight[];
  initialArchive: ArchiveItem[];
}) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const [archive, setArchive] = useState(initialArchive);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverInput = useRef<HTMLInputElement>(null);
  // Set in the click handler right before the picker opens, so no effect is needed
  // to remember which highlight the file belongs to.
  const coverTarget = useRef<string | null>(null);

  async function reload() {
    const res = await fetch("/api/highlights");
    const body = (await res.json().catch(() => null)) as {
      highlights?: ClientHighlight[];
      archive?: ArchiveItem[];
    } | null;
    if (body?.highlights) setHighlights(body.highlights);
    if (body?.archive) setArchive(body.archive);
  }

  async function act(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "That did not work.");
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const next = title.trim();
    if (next === "") return;
    setTitle("");
    await act({ action: "create", title: next });
  }

  async function uploadCover(file: File) {
    const id = coverTarget.current;
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("slot", "HIGHLIGHT_COVER");
      form.append("file", file);
      const res = await fetch("/api/profile-asset", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        asset?: { key: string };
        error?: string;
      } | null;
      if (!res.ok || !body?.asset) throw new Error(body?.error ?? "That did not upload.");
      // Separate call on purpose: the asset exists whether or not the highlight
      // accepts it, and the cover is a reference to a key the server minted.
      await act({ action: "setCover", id, assetKey: body.asset.key });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not upload.");
    } finally {
      setBusy(false);
      coverTarget.current = null;
    }
  }

  async function destroyStory(storyId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not delete that.");
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that.");
    } finally {
      setBusy(false);
    }
  }

  function assign(item: ArchiveItem, nextId: string) {
    if (nextId === "") {
      if (item.highlight) void act({ action: "remove", postId: item.story.id });
      return;
    }
    void act({ action: "add", id: nextId, postId: item.story.id });
  }

  return (
    <Section title="Highlights">
      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadCover(file);
          e.target.value = "";
        }}
      />

      <div>
        <label htmlFor="highlight-title" className="text-xs font-medium text-muted">
          New highlight
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="highlight-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            maxLength={limits.highlightTitleMaxLength}
            placeholder="Goa 2026"
            className="h-10 flex-1 rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || title.trim() === ""}
            className="flex h-10 items-center gap-1.5 rounded-ctl border border-line-strong bg-panel-3 px-3.5 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Create
          </button>
        </div>
      </div>

      {highlights.length > 0 && (
        <ul className="space-y-2">
          {highlights.map((highlight) => (
            <li
              key={highlight.id}
              className="flex items-center gap-3 rounded-ctl border border-line px-3 py-2.5"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line-strong bg-panel-2">
                {highlight.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={highlight.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-xs font-semibold text-faint">
                    {highlight.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <input
                  defaultValue={highlight.title}
                  maxLength={limits.highlightTitleMaxLength}
                  aria-label={`Rename ${highlight.title}`}
                  // Renamed on blur rather than per keystroke — one write when you
                  // are done, not one per letter.
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next !== "" && next !== highlight.title) {
                      void act({ action: "rename", id: highlight.id, title: next });
                    } else {
                      e.target.value = highlight.title;
                    }
                  }}
                  className="w-full rounded-ctl bg-transparent text-sm font-semibold text-ink"
                />
                <p className="text-[11px] text-faint">
                  {highlight.count} {highlight.count === 1 ? "story" : "stories"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  coverTarget.current = highlight.id;
                  coverInput.current?.click();
                }}
                disabled={busy}
                className="h-8 shrink-0 rounded-ctl border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                Cover
              </button>
              <button
                type="button"
                onClick={() => void act({ action: "delete", id: highlight.id })}
                disabled={busy}
                aria-label={`Delete ${highlight.title}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border border-line text-muted transition-colors hover:border-line-strong hover:text-danger disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line pt-4">
        <p className="text-xs font-medium text-muted">
          Story archive ({archive.length})
        </p>
        {archive.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-faint">
            Nothing yet. Post a story from the tray at the top of the feed.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {archive.map((item) => (
              <ArchiveCard
                key={item.story.id}
                item={item}
                highlights={highlights}
                busy={busy}
                onAssign={assign}
                onDelete={destroyStory}
              />
            ))}
          </ul>
        )}
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
          Working…
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </Section>
  );
}

function ArchiveCard({
  item,
  highlights,
  busy,
  onAssign,
  onDelete,
}: {
  item: ArchiveItem;
  highlights: ClientHighlight[];
  busy: boolean;
  onAssign: (item: ArchiveItem, nextId: string) => void;
  onDelete: (storyId: string) => void;
}) {
  const { story } = item;
  const thumb = story.posterUrl ?? (story.kind === "IMAGE" ? story.mediaUrl : null);

  return (
    <li className="overflow-hidden rounded-ctl border border-line">
      <div className="relative flex h-28 items-center justify-center bg-panel-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-[11px] font-medium text-faint">
            {story.kind.toLowerCase()}
          </span>
        )}
        <span
          className={`absolute left-1.5 top-1.5 rounded-pill px-1.5 py-0.5 text-[10px] font-semibold ${
            item.live ? "bg-panel-3 text-ink" : "bg-panel text-faint"
          }`}
        >
          {item.highlight ? "kept" : item.live ? "live" : "expired"}
        </span>
      </div>
      <div className="space-y-1.5 px-2 py-2">
        <select
          value={item.highlight?.id ?? ""}
          onChange={(e) => onAssign(item, e.target.value)}
          disabled={busy || highlights.length === 0}
          aria-label="Highlight"
          className="h-8 w-full rounded-ctl border border-line bg-panel-2 px-1.5 text-[11px] text-ink disabled:opacity-50"
        >
          <option value="">Not kept</option>
          {highlights.map((highlight) => (
            <option key={highlight.id} value={highlight.id}>
              {highlight.title}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-faint">
            {story.viewsCount ?? 0} {story.viewsCount === 1 ? "view" : "views"}
          </span>
          <button
            type="button"
            onClick={() => onDelete(story.id)}
            disabled={busy}
            aria-label="Delete story"
            className="flex h-7 w-7 items-center justify-center rounded-ctl text-faint transition-colors hover:text-danger disabled:opacity-50"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}
