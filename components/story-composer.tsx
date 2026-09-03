"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { limits } from "@/lib/config";
import type { ClientAuthor, ClientStory } from "@/lib/types";
import { CameraIcon, SpinnerIcon, XIcon } from "./icons";
import { MediaPlayer } from "./media-player";

/**
 * Posting a story: pick a file, optionally caption it, send.
 *
 * Deliberately thinner than the post composer — no kind picker and no tweet text.
 * A story is whatever file you handed over, and the server sniffs the kind from the
 * bytes rather than trusting a label. Same upload path as a post, so the same
 * encryption, EXIF stripping and archive queue apply; the only difference is the
 * 24-hour clock the row is stamped with.
 *
 * On success this hands the finished story — and the preview it was showing — up
 * to the tray, which flies it into place. No `router.refresh()`: reloading the
 * whole feed to make one 58px ring appear is what made posting a story feel like
 * it had not worked.
 */

/**
 * What the composer hands over when the upload lands.
 *
 * `previewUrl` is an object URL and ownership of it transfers with this object:
 * the composer stops revoking it, and whoever takes it must revoke it when the
 * flight is done or the file stays pinned in memory for the life of the tab.
 */
export interface PostedStory {
  author: ClientAuthor;
  story: ClientStory;
  previewUrl: string;
  previewKind: "IMAGE" | "VIDEO" | "AUDIO";
  /** Where the preview sat on screen, so the ring knows where to fly from. */
  from: DOMRect;
}

interface StoryComposerProps {
  onClose: () => void;
  onPosted?: (posted: PostedStory) => void;
}

const MAX_MB = Math.round(limits.maxUploadBytes / (1024 * 1024));

export function StoryComposer({ onClose, onPosted }: StoryComposerProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The preview URL is minted in the change handler and revoked as soon as it is
  // replaced or the dialog closes. Left alone, every pick pins the whole file in
  // memory for the lifetime of the tab.
  const urlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    shellRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function choose(next: File | null) {
    setError(null);
    if (next && next.size > limits.maxUploadBytes) {
      // Checked here as well as on the server, so a 200 MB video fails instantly
      // rather than after a long upload.
      setError(`That is over the ${MAX_MB} MB limit.`);
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (!next) {
      urlRef.current = null;
      setPicked(null);
      return;
    }
    const url = URL.createObjectURL(next);
    urlRef.current = url;
    setPicked({ file: next, url });
  }

  async function send() {
    const file = picked?.file;
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (caption.trim()) form.append("caption", caption.trim());

      // Measured before the request, while the dialog is certainly still on
      // screen and laid out.
      const from = previewRef.current?.getBoundingClientRect() ?? null;

      const res = await fetch("/api/stories", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        author?: ClientAuthor;
        story?: ClientStory;
      } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? "That did not go through.");
      }

      const url = urlRef.current;
      if (onPosted && body?.author && body?.story && from && url) {
        // Ownership of the object URL goes with it — clearing the ref here is what
        // stops the unmount cleanup below from revoking the picture mid-flight.
        urlRef.current = null;
        onPosted({
          author: body.author,
          story: body.story,
          previewUrl: url,
          previewKind: isVideo ? "VIDEO" : isAudio ? "AUDIO" : "IMAGE",
          from,
        });
        onClose();
        return;
      }

      // No flight possible — a caller that does not take one, or a response
      // without the row. Fall back to the reload rather than leaving the tray
      // showing a story that is not there.
      onClose();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  const isVideo = picked?.file.type.startsWith("video/") === true;
  const isAudio = picked?.file.type.startsWith("audio/") === true;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post a story"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
    >
      <div
        ref={shellRef}
        tabIndex={-1}
        className="panel flex max-h-full w-full max-w-[420px] flex-col overflow-y-auto shadow-pop outline-none"
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <CameraIcon className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold text-ink">Post a story</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-pill text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="hidden"
          />

          {picked ? (
            <div
              ref={previewRef}
              className="overflow-hidden rounded-ctl border border-line bg-black"
            >
              {isVideo ? (
                <MediaPlayer
                  kind="VIDEO"
                  src={picked.url}
                  maxHeight="46vh"
                />
              ) : isAudio ? (
                <MediaPlayer kind="AUDIO" src={picked.url} className="px-2 py-2" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={picked.url}
                  alt=""
                  className="max-h-[46vh] w-full object-contain"
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-ctl border border-dashed border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
            >
              <CameraIcon className="h-6 w-6" />
              <span className="text-xs font-medium">
                Pick an image, video or clip
              </span>
              <span className="text-[11px] text-faint">Up to {MAX_MB} MB</span>
            </button>
          )}

          {picked && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-[11px] font-medium text-muted underline decoration-line-strong transition-colors hover:text-ink"
            >
              Pick a different one
            </button>
          )}

          <div>
            <label htmlFor="story-caption" className="text-xs text-muted">
              Caption (optional)
            </label>
            <input
              id="story-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={limits.captionMaxLength}
              placeholder="Context, if it needs any"
              className="mt-1.5 h-10 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-ctl border border-line px-4 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!picked || busy}
            className="ml-auto flex h-9 items-center gap-2 rounded-ctl bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            {busy ? "Posting…" : "Post story"}
          </button>
        </footer>
      </div>
    </div>
  );
}
