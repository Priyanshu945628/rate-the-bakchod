"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";
import { BrandMark } from "./brand-mark";
import { CameraButton } from "./camera/camera-launcher";
import {
  HomeIcon,
  MessageIcon,
  SearchIcon,
  ShieldIcon,
  TrophyIcon,
  UserIcon,
} from "./icons";
import { useRealtime } from "./realtime-provider";

/**
 * Primary navigation. A floating glass column on the left at desktop widths, the
 * same items as a floating bar at the bottom on phones — one source of truth for
 * both, and two short lists off it where they disagree.
 *
 * They disagree twice. The camera is in the bar and not the column: on a phone it wants
 * to be under a thumb, and at desktop widths the same button is already in the top bar.
 * Messages is in the column and not the bar, because the bar is about five slots wide at
 * 360px and Search wanted one — on a phone the inbox is a button in the top bar instead,
 * `components/inbox-button.tsx`, which is where the unread dot goes with it.
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
  { href: "/search", label: "Search", Icon: SearchIcon },
  { href: "/leaderboard", label: "Leaderboard", Icon: TrophyIcon },
];

const INBOX_ITEM: Item = {
  href: "/messages",
  label: "Messages",
  Icon: MessageIcon,
  dot: true,
};

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

  const tail: Item[] = [
    ...(handle
      ? [
          {
            href: `/u/${encodeURIComponent(handle)}`,
            label: "Profile",
            Icon: UserIcon,
          },
        ]
      : []),
    ...(isAdmin ? [ADMIN_ITEM] : []),
  ];

  // The one place the two navigations differ in what they point at.
  const railItems: Item[] = [...ITEMS, ...(handle ? [INBOX_ITEM] : []), ...tail];
  const barItems: Item[] = [...ITEMS, ...tail];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Where the `+` goes in the bar: mid-list, so it falls under a thumb instead of at one
  // end. Signed out there is nowhere for a shot to go, so nothing is inserted at all.
  const camera = handle ? Math.floor(barItems.length / 2) : -1;

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

        {railItems.map(({ href, label, Icon, dot }) => {
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

      {/* Mobile tab bar — floating, the same items as the desktop column bar Messages,
          plus the camera in the middle of them.

          `kb-hide` takes it off the screen while the on-screen keyboard is up. It is
          `position: fixed`, and on iOS a fixed element does not move for the keyboard —
          so without this it floats on top of the composer somebody is typing into. It is
          also why Search does not focus its box on arrival: landing here from this bar
          would make the bar you just tapped disappear.

          `app-chrome` is the other way it leaves: an open thread on a phone is the
          whole screen, and the thread has its own way back. See `app/globals.css`. */}
      <nav
        aria-label="Main"
        className="app-chrome glass-bar kb-hide fixed inset-x-3 bottom-3 z-30 flex h-16 items-stretch rounded-card lg:hidden"
      >
        {barItems.map(({ href, label, Icon }, index) => {
          const active = isActive(href);
          return (
            <Fragment key={href}>
              {index === camera ? <CameraButton variant="tab" /> : null}
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-card text-[11px] ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </Fragment>
          );
        })}
      </nav>
    </>
  );
}
