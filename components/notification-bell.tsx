"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./icons";
import { useRealtime } from "./realtime-provider";

/**
 * The bell. A shortcut to `/notifications` and a live count, and nothing else.
 *
 * The list used to drop out of this button. It now has a page of its own — see
 * `components/notification-panel.tsx` for why — which leaves the bell with the one job
 * a permanent piece of chrome should have: say whether there is anything to look at,
 * and go there.
 *
 * The badge is state of its own rather than something derived from a loaded list,
 * because it has to be right without the panel ever having been opened. It arrives
 * server-rendered, then follows the stream: `notification` when one lands, and `unread`
 * when a total is corrected somewhere else — opening the panel in another tab, or
 * opening a thread, which marks the message row it left behind read.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const pathname = usePathname();
  const here = pathname === "/notifications";

  useRealtime(
    useCallback((event) => {
      if (event.type === "unread") setUnread(event.notifications);
      else if (event.type === "notification") setUnread(event.unread);
    }, []),
  );

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      aria-current={here ? "page" : undefined}
      className={`relative flex h-9 w-9 items-center justify-center rounded-ctl transition-colors ${
        here ? "bg-panel-3 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"
      }`}
    >
      <BellIcon className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 text-[10px] font-bold tabular-nums text-panel">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
