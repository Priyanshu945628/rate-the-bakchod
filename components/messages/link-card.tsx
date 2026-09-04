"use client";

import { useEffect, useState } from "react";
import type { ClientLinkPreview } from "@/lib/types";
import { splitLinks } from "./linkify";

/**
 * The card under a pasted link.
 *
 * The bubble already shows the URL as an anchor — this is what is on the other end of
 * it, so a link is worth reading before it is worth opening. Only the *first* link in a
 * message gets one: three cards stacked under one sentence is a wall, and the first URL
 * is the one the message is about.
 *
 * Nothing is stored on the message. The lookup happens when a bubble that has a link in
 * it renders, which means the card can arrive a moment after the text and can never
 * arrive at all — an unreachable site, or a page with no metadata worth drawing. Both
 * render as no card rather than as an empty one or an error, because a failed unfurl is
 * not something the person who sent the message did wrong.
 */

/** The first `http(s)` link in a body, using the same splitter the anchors use. */
function firstHref(text: string): string | null {
  for (const part of splitLinks(text)) if (part.href) return part.href;
  return null;
}

/**
 * One request per URL for as long as the tab lives, shared by every bubble.
 *
 * A link pasted back and forth in a thread is one lookup, and a URL that turned out to
 * have no card is not asked about again — the promise is kept, resolved value and all,
 * so a `null` is as final here as a hit.
 */
const lookups = new Map<string, Promise<ClientLinkPreview | null>>();

function load(href: string): Promise<ClientLinkPreview | null> {
  const running = lookups.get(href);
  if (running) return running;

  const job = fetch(`/api/link-preview?url=${encodeURIComponent(href)}`)
    .then((res) =>
      res.ok ? (res.json() as Promise<{ preview: ClientLinkPreview | null }>) : null,
    )
    .then((data) => data?.preview ?? null)
    .catch(() => null);

  lookups.set(href, job);
  return job;
}

export function LinkCard({ text }: { text: string }) {
  const href = firstHref(text);
  /**
   * The href is kept beside the preview rather than in a second state, so an edited
   * message cannot show the old page's card while the new URL is still being looked
   * up: the render below only trusts a result that belongs to the link on screen.
   */
  const [loaded, setLoaded] = useState<{
    href: string;
    preview: ClientLinkPreview | null;
  } | null>(null);

  useEffect(() => {
    if (!href) return;
    let alive = true;
    void load(href).then((preview) => {
      if (alive) setLoaded({ href, preview });
    });
    return () => {
      alive = false;
    };
  }, [href]);

  if (!href || loaded?.href !== href || !loaded.preview) return null;
  const { host, title, description, icon } = loaded.preview;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-1.5 block overflow-hidden rounded-ctl border border-line bg-panel/60 px-2.5 py-2 transition-colors hover:bg-panel"
    >
      <span className="flex items-center gap-1.5">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="h-3 w-3 shrink-0 rounded-[3px]" />
        ) : null}
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
          {host}
        </span>
      </span>

      {title ? (
        // No `block` beside `line-clamp-2`: both set `display`, and Tailwind emits the
        // display utilities after the clamp, so `block` would win the cascade and the
        // clamp would silently stop clamping. The clamp is block-level on its own.
        <span className="mt-0.5 break-words text-[12.5px] font-semibold leading-snug text-ink line-clamp-2">
          {title}
        </span>
      ) : null}

      {description ? (
        <span className="mt-0.5 break-words text-[11.5px] leading-snug text-muted line-clamp-2">
          {description}
        </span>
      ) : null}
    </a>
  );
}
