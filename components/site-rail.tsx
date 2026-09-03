"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "./brand-mark";
import { HomeIcon, MessageIcon, ShieldIcon, TrophyIcon, UserIcon } from "./icons";
import { useRealtime } from "./realtime-provider";

/**
 * Primary navigation. A floating glass column on the left at desktop widths, the
 * same items as a floating bar at the bottom on phones — one source of truth for
 * both.
 *
 * Editing your profile is not here. It lives on the profile itself, where you can
 * see what you are editing.
 *
 * Nothing in here is accent-coloured, including the mark. The accent is spent on
 * rank numbers and the one primary action per surface, and permanent chrome is the
 * opposite of sparing. The unread dot is the single exception, and it is a dot
 * rather than a number: the count belongs on the row it applies to.
 *
 * One size for everything in here: 40px tiles holding 20px glyphs, the navigation
 * step of the ladder in `icons.tsx`. The mark takes the same 20px as the items
 * below it — a logo that runs larger than the navigation it sits on top of is the
 * heaviest thing on the screen, which is the opposite of what chrome is for.
 */

interface Item {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Whether to draw the unread dot on this item. */
  dot?: boolean;
}

const ITEMS: Item[] = [
  { href: "/", label: "Feed", Icon: HomeIcon },
  { href: "/leaderboard", label: "Leaderboard", Icon: TrophyIcon },
];

const ADMIN_ITEM: Item = { href: "/admin", label: "Moderation", Icon: ShieldIcon };

/**
 * `handle` is the signed-in viewer's; without one there is no profile to link and
 * no inbox to point at. `unreadConversations` is server-rendered so the dot is
 * right in the first paint, then kept current from the stream.
 */
export function SiteRail({
  isAdmin = false,
  handle = null,
  unreadConversations = 0,
}: {
  isAdmin?: boolean;
  handle?: string | null;
  unreadConversations?: number;
}) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(unreadConversations);

  // Both events carry the viewer's own conversation total: `message` because a new
  // one arrived, `unread` because a thread was read in some other tab.
  useRealtime((event) => {
    if (event.type === "message") setUnread(event.unreadConversations);
    else if (event.type === "unread") setUnread(event.conversations);
  });

  const items: Item[] = [
    ...ITEMS,
    ...(handle
      ? [
          { href: "/messages", label: "Messages", Icon: MessageIcon, dot: true },
          {
            href: `/u/${encodeURIComponent(handle)}`,
            label: "Profile",
            Icon: UserIcon,
          },
        ]
      : []),
    ...(isAdmin ? [ADMIN_ITEM] : []),
  ];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Desktop rail */}
      <nav
        aria-label="Main"
        className="panel sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-[68px] shrink-0 flex-col items-center gap-1 py-3.5 lg:flex"
      >
        <Link
          href="/"
          aria-label="Rate the Bakchod"
          className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-ctl border border-line-strong bg-panel-3 text-ink"
        >
          <BrandMark className="h-5 w-5" />
        </Link>

        {items.map(({ href, label, Icon, dot }) => {
          const active = isActive(href);
          const show = Boolean(dot) && unread > 0;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={show ? `${label}, ${unread} unread` : label}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-10 w-10 items-center justify-center rounded-ctl border transition-colors ${
                active
                  ? "border-line-strong bg-panel-3 text-ink"
                  : "border-transparent text-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5" />
              {show ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Mobile tab bar — floating, matching the desktop column */}
      <nav
        aria-label="Main"
        className="glass-bar fixed inset-x-3 bottom-3 z-30 flex h-16 items-stretch rounded-card lg:hidden"
      >
        {items.map(({ href, label, Icon, dot }) => {
          const active = isActive(href);
          const show = Boolean(dot) && unread > 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={show ? `${label}, ${unread} unread` : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-card text-[11px] ${
                active ? "text-ink" : "text-muted"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
              {show ? (
                <span className="absolute left-1/2 top-2.5 ml-2 h-1.5 w-1.5 rounded-full bg-accent" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
