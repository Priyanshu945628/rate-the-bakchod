"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageIcon, SpinnerIcon } from "./icons";

/**
 * "Message" on someone else's profile.
 *
 * A POST rather than a link, because the thread may not exist yet and its id is the
 * server's to choose. `openConversation` is keyed on the pair, so pressing this twice
 * — or pressing it after the other person already did — lands in the same thread
 * instead of making a second one.
 *
 * `busy` is not cleared on success: the push is what ends this component's life, and
 * flicking back to the idle label first would look like the press had failed.
 */
export function MessageButton({ handle }: { handle: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not open that.");
      router.push(`/messages/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that.");
      setBusy(false);
    }
  }

  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="flex h-8 items-center gap-1.5 rounded-pill border border-line px-3 text-xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
      >
        {busy ? (
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MessageIcon className="h-3.5 w-3.5" />
        )}
        Message
      </button>

      {error ? (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap text-[11px] text-danger"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
