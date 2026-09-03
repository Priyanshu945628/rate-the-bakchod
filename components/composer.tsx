"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientViewer } from "@/lib/types";
import { ClipIcon, SpinnerIcon, XIcon } from "./icons";
import { SignInPrompt } from "./sign-in-prompt";

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Post composer.
 *
 * The upload returns as soon as the file is encrypted and cached — the archive
 * push happens behind it — so `router.refresh()` right after is enough to show
 * the new post at the top of the feed.
 */
export function Composer({ viewer }: { viewer: ClientViewer | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tweetText, setTweetText] = useState("");
  const [showTweet, setShowTweet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs are a real allocation. `pick` below releases each one the moment
  // it is replaced, so this only has to catch the last one still open on unmount.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  if (!viewer) {
    return (
      <div className="panel px-4 py-5 shadow-card">
        <SignInPrompt className="justify-center">
          Sign in to submit evidence of bakchodi.
        </SignInPrompt>
      </div>
    );
  }

  function pick(next: File | null) {
    setError(null);
    if (next && next.size > MAX_BYTES) {
      setError("That file is over 100 MB. Trim it down.");
      return;
    }

    // Only images get a local preview; a video would have to decode to show one.
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current =
      next && next.type.startsWith("image/") ? URL.createObjectURL(next) : null;
    setPreview(previewRef.current);
    setFile(next);
  }

  function clearFile() {
    pick(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!file && tweetText.trim().length === 0) {
      setError("Attach something, or paste a tweet.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      if (file) form.set("file", file);
      if (caption.trim()) form.set("caption", caption.trim());
      if (tweetText.trim()) form.set("tweetText", tweetText.trim());

      const res = await fetch("/api/posts", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }

      clearFile();
      setCaption("");
      setTweetText("");
      setShowTweet(false);
      router.refresh();
    } catch {
      setError("Upload failed on the way out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel px-4 py-4 shadow-card">
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What did this bakchod do?"
        className="w-full resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 text-[15px] text-ink placeholder:text-faint"
      />

      {showTweet && (
        <textarea
          value={tweetText}
          onChange={(e) => setTweetText(e.target.value)}
          rows={3}
          maxLength={600}
          placeholder="Paste the tweet text here…"
          className="mt-2 w-full resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink placeholder:text-faint"
        />
      )}

      {file && (
        <div className="mt-3 flex items-center gap-3 rounded-ctl border border-line bg-panel-2 p-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="h-14 w-14 rounded-[8px] object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-[8px] bg-panel-3 text-muted">
              <ClipIcon className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{file.name}</p>
            <p className="text-xs text-faint">
              {(file.size / 1048576).toFixed(1)} MB
            </p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            aria-label="Remove file"
            className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-panel-3 hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="hidden"
          id="composer-file"
        />
        <label
          htmlFor="composer-file"
          className="flex h-9 cursor-pointer items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <ClipIcon className="h-4 w-4" />
          Image / video / audio
        </label>

        <button
          type="button"
          onClick={() => setShowTweet((v) => !v)}
          className="h-9 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          {showTweet ? "Drop tweet text" : "Paste a tweet"}
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="ml-auto flex h-9 items-center gap-2 rounded-ctl bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
          {busy ? "Processing…" : "Post"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {busy && (
        <p className="mt-2 text-xs text-faint">
          Stripping metadata, re-encoding and encrypting. Big videos take a moment.
        </p>
      )}
    </div>
  );
}
