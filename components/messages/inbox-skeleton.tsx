"use client";

import { usePathname } from "next/navigation";
import { Bar, Dot } from "../skeleton";

/**
 * The thread list, before it arrives.
 *
 * A client component for one reason: it has to disappear on a phone when a thread is
 * open, and that is decided from the pathname — the same rule `ConversationList` uses,
 * because the two swap places and a fallback with different visibility rules than the
 * thing it stands in for would make the layout jump at exactly the moment it fills in.
 *
 * The header and the search field are drawn for real rather than as bars. They do not
 * depend on the query that is still running, so showing them as placeholders would be
 * pretending to wait for something already known.
 */
export function InboxSkeleton() {
  const pathname = usePathname();
  const threadOpen = pathname.startsWith("/messages/");

  return (
    <aside
      aria-hidden
      className={`panel w-full shrink-0 flex-col overflow-hidden lg:flex lg:w-[336px] ${
        threadOpen ? "hidden" : "flex"
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <h1 className="mr-auto text-[15px] font-semibold tracking-tight text-ink">Messages</h1>
        <Bar className="h-8 w-8 rounded-ctl" />
      </header>

      <div className="border-b border-line px-3 py-2">
        <Bar className="h-[34px] w-full" />
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-line overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2.5">
            <Dot size={44} />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-3 w-28 max-w-[55%]" />
              <Bar className="h-2.5 w-40 max-w-[80%]" />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
