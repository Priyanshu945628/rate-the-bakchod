"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageIcon } from "./icons";
import { useRealtime } from "./realtime-provider";

/**
 * The inbox, in the top bar and only on a phone.
 *
 * At desktop widths the rail is a column with room to spare and Messages is a row in it.
 * The bottom bar on a phone has about five slots, Search took one, and a sixth would put
 * "Leaderboard" wider than the space it has to sit in — so the inbox moves up here rather
 * than lose a destination. `lg:hidden` against the rail's own `lg:flex` is the seam:
 * exactly one of the two is on screen at any width.
 *
 * A dot rather than a count, matching the row this replaces. The number of unread
 * messages belongs on the thread it applies to, and every one of those is a row on
 * `/messages` — one tap away.
 *
 * Seeded from the server so it is right in the first paint rather than popping in when
 * the stream connects, then kept current by it: `message` when one arrives, `unread`
 * when a thread is read in some other tab.
 */
export function InboxButton({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const pathname = usePathname();
  const here = pathname.startsWith("/messages");

  useRealtime((event) => {
    if (event.type === "message") setUnread(event.unreadConversations);
    else if (event.type === "unread") setUnread(event.conversations);
  });

  return (
    <Link
      href="/messages"
      aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      aria-current={here ? "page" : undefined}
      className={`relative flex h-9 w-9 items-center justify-center rounded-ctl transition-colors lg:hidden ${
        here ? "bg-panel-3 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"
      }`}
    >
      <MessageIcon className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
      )}
    </Link>
  );
}
