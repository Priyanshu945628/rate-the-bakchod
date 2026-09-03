import Link from "next/link";
import { Bar, Dot } from "@/components/skeleton";
import { ChevronLeftIcon } from "@/components/icons";

/**
 * One conversation, before it arrives.
 *
 * Same outer shell and visibility as `Thread` itself — `panel flex min-w-0 flex-1` with
 * nothing hidden — because on a phone this pane has already replaced the list by the
 * time it renders, and a fallback shaped differently from the thing it stands in for
 * makes the layout jump at exactly the moment it fills in. Same rule as
 * `components/messages/inbox-skeleton.tsx`.
 *
 * The bubbles sit at the bottom. The real thread scrolls to its last message on open,
 * so placeholders stacked from the top would all slide down when the messages land.
 *
 * The back chevron is a real link, not a bar. It goes to `/messages` whatever the fetch
 * comes back with, and on a phone it is the only way out of a pane that is still
 * loading — a placeholder there would be a dead control.
 */
export default function ThreadLoading() {
  return (
    <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <Link
          href="/messages"
          aria-label="Back to conversations"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-panel-2 hover:text-ink lg:hidden"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-0.5">
          <Dot size={36} />
          <div className="min-w-0 space-y-2">
            <Bar className="h-3 w-32 max-w-[55%]" />
            <Bar className="skeleton-still h-2.5 w-20" />
          </div>
        </div>

        <span className="flex shrink-0 items-center gap-0.5">
          <Bar className="skeleton-still h-8 w-8 rounded-ctl" />
          <Bar className="skeleton-still h-8 w-8 rounded-ctl" />
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
        <ul className="flex h-full flex-col justify-end space-y-1.5">
          {BUBBLES.map((bubble, i) => (
            <li key={i} className={`flex ${bubble.mine ? "justify-end" : "justify-start"}`}>
              <Bar className={`rounded-card ${bubble.size}`} />
            </li>
          ))}
        </ul>
      </div>

      {/* Still, not pulsing: the composer is the same three controls on every thread
          and is not one of the things being waited for. */}
      <div className="border-t border-line px-2.5 py-2">
        <div className="flex items-end gap-1.5">
          <Bar className="skeleton-still h-9 w-9 shrink-0 rounded-ctl" />
          <Bar className="skeleton-still h-9 min-w-0 flex-1 rounded-ctl" />
          <Bar className="skeleton-still h-9 w-9 shrink-0 rounded-ctl" />
        </div>
      </div>
    </section>
  );
}

/**
 * The shape of a conversation: sides alternating unevenly, one long reply, one that is
 * two lines. A perfect left-right-left ladder of equal blocks reads as a table.
 */
const BUBBLES = [
  { mine: false, size: "h-9 w-44 max-w-[70%]" },
  { mine: true, size: "h-9 w-32 max-w-[60%]" },
  { mine: true, size: "h-14 w-64 max-w-[78%]" },
  { mine: false, size: "h-9 w-28 max-w-[55%]" },
  { mine: false, size: "h-14 w-56 max-w-[75%]" },
  { mine: true, size: "h-9 w-40 max-w-[65%]" },
  { mine: false, size: "h-9 w-36 max-w-[62%]" },
];
