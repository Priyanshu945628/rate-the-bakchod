import Link from "next/link";
import type { ClientPerson } from "@/lib/types";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";

/**
 * The suggestion rail beside the feed.
 *
 * Server-rendered — the list only changes when the graph does, and a follow here
 * refreshes the page anyway. Nothing is hidden behind a "why am I seeing this":
 * the reason the server picked someone is printed on their row or it is not there
 * at all.
 */
export function SuggestedPeople({ people }: { people: ClientPerson[] }) {
  if (people.length === 0) return null;

  return (
    <section className="panel shadow-card">
      <h2 className="px-3.5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-faint">
        People to follow
      </h2>

      <ul className="divide-y divide-line">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
            <Link href={`/u/${person.handle}`} className="shrink-0">
              <Avatar
                src={person.avatarUrl}
                name={person.displayName}
                size={34}
                isAI={person.isAI}
              />
            </Link>

            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${person.handle}`}
                className="block truncate text-[13px] font-semibold text-ink hover:underline"
              >
                {person.displayName}
              </Link>
              <p className="truncate text-[11px] text-faint">
                {/* The AI never shows a number — it cannot be rated, so there is
                    no score to show and a 0 would read as an insult rather than
                    an absence. */}
                {person.reason ??
                  (person.isAI
                    ? "House account"
                    : (person.tagline ?? `${person.followersCount} followers`))}
              </p>
            </div>

            <FollowButton
              handle={person.handle}
              isFollowing={person.isFollowing}
              size="sm"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
