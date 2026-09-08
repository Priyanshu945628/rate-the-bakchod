"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { limits } from "@/lib/config";
import type { ClientViewer } from "@/lib/types";
import { ClipIcon, PollIcon, SpinnerIcon, XIcon } from "./icons";
import { SignInPrompt } from "./sign-in-prompt";

const MAX_MB = Math.round(limits.maxUploadBytes / 1048576);

/** One empty box per allowed option, so opening the poll never needs an "add" button. */
const EMPTY_OPTIONS = Array.from({ length: limits.pollMaxOptions }, () => "");

/**
 * Post composer.
 *
 * One box for the words, and what they become depends on what is attached: with a
 * file they are the caption, without one they are the post. There is no separate
 * "paste a tweet" field — a post with nothing but text is the ordinary case, not a
 * special mode you have to switch into.
 *
 * The upload returns as soon as the file is encrypted and cached — the archive
 * push happens behind it — so `router.refresh()` right after is enough to show
 * the new post at the top of the feed.
 *
 * `official` is the admin panel's copy of this. It sends one extra field and the
 * route ignores that field for everyone who is not an admin, so this prop is a
 * label rather than a permission. Announcements cannot be polls: an update the
 * platform is publishing is not a question it is asking.
 */
export function Composer({
  viewer,
  official = false,
}: {
  viewer: ClientViewer | null;
  official?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
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
    if (next && next.size > limits.maxUploadBytes) {
      setError(`That file is over ${MAX_MB} MB. Trim it down.`);
      return;
    }

    // Only images get a local preview; a video would have to decode to show one.
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current =
      next && next.type.startsWith("image/") ? URL.createObjectURL(next) : null;
    setPreview(previewRef.current);
    setFile(next);
    // Attaching something is the other half of `togglePoll`: a poll cannot carry a
    // file, so picking one closes the poll.
    if (next) setPollOpen(false);
  }

  function clearFile() {
    pick(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function togglePoll() {
    setError(null);
    const opening = !pollOpen;
    setPollOpen(opening);
    // A poll carries no file and a file cancels a poll, so whichever one is being
    // turned on clears the other here rather than letting the server refuse a
    // state this box allowed you to build.
    if (opening) clearFile();
    else setOptions(EMPTY_OPTIONS);
  }

  function setOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  async function submit() {
    const words = text.trim();
    const filled = pollOpen ? options.map((o) => o.trim()).filter(Boolean) : [];

    if (pollOpen) {
      if (!words) {
        setError("Ask the question first.");
        return;
      }
      if (filled.length < limits.pollMinOptions) {
        setError(`A poll needs at least ${limits.pollMinOptions} options.`);
        return;
      }
    } else if (!file && !words) {
      setError(official ? "Write the update first." : "Write something, or attach a file.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      if (file) form.set("file", file);
      if (official) form.set("official", "1");
      for (const option of filled) form.append("pollOption", option);

      // Where the words go is the one thing this box decides for you. A poll's
      // question and a caption under a file are both `caption`; on their own they
      // are the post itself, which the API takes as `tweetText`.
      if (words) form.set(file || pollOpen ? "caption" : "tweetText", words);

      const res = await fetch("/api/posts", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }

      clearFile();
      setText("");
      setOptions(EMPTY_OPTIONS);
      setPollOpen(false);
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
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={official ? 4 : 2}
        // 500 either way: attached to a file or a poll these words become the
        // caption, and that is the shorter of the two server-side caps.
        maxLength={500}
        placeholder={
          official
            ? "What changed."
            : pollOpen
              ? "Ask something."
              : "What did this bakchod do?"
        }
        className="w-full resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 text-[15px] text-ink placeholder:text-faint"
      />

      {pollOpen && (
        <div className="mt-2 space-y-2">
          {options.map((option, i) => (
            <input
              key={i}
              value={option}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={limits.pollOptionMaxLength}
              aria-label={`Option ${i + 1}`}
              placeholder={
                i < limits.pollMinOptions ? `Option ${i + 1}` : `Option ${i + 1} (optional)`
              }
              className="w-full rounded-ctl border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-faint"
            />
          ))}
        </div>
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

        {!official && (
          <button
            type="button"
            onClick={togglePoll}
            aria-pressed={pollOpen}
            className={`flex h-9 items-center gap-2 rounded-ctl border px-3 text-xs font-medium transition-colors ${
              pollOpen
                ? "border-line-strong bg-panel-3 text-ink"
                : "border-line text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            <PollIcon className="h-4 w-4" />
            Poll
          </button>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="ml-auto flex h-9 items-center gap-2 rounded-ctl bg-accent px-5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy && <SpinnerIcon className="h-4 w-4 animate-spin" />}
          {busy ? "Processing…" : official ? "Publish" : "Post"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
