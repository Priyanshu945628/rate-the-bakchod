import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { fetchSuggestions, searchPeople } from "@/lib/follows";
import { searchPosts, toClientPost, toClientViewer } from "@/lib/posts";
import {
  isSearchable,
  normalizeQuery,
  parseSearchTab,
  searchHref,
  SEARCH_TABS,
} from "@/lib/search";
import { PersonRow } from "@/components/people-list";
import { SearchBox, SearchPeople, SearchPosts } from "@/components/search-view";

export const metadata: Metadata = {
  title: "Search · Rate the Bakchod",
  // Every query is its own URL and none of them is a page of the site. The posts and
  // profiles behind them are indexed where they live.
  robots: { index: false, follow: true },
};

/**
 * Search, over posts and people.
 *
 * `?q=` is the state and this page is what reads it — the box in
 * `components/search-view.tsx` only writes to the URL. So the first page of results is
 * server-rendered like any feed, the tabs are ordinary links, and a search survives a
 * reload, a share and the Back button for free.
 *
 * Only the visible tab is queried. Counting the other one would mean running it too, and
 * the number is not worth doubling the work of every keystroke.
 *
 * Below {@link isSearchable} there are no results to show and no tabs worth showing, so
 * the page falls back to suggestions — people to follow, which is the other reason
 * somebody opens this. Nothing explains any of that in words.
 */
export default async function SearchPage(props: PageProps<"/search">) {
  const { q: rawQuery, type: rawType } = await props.searchParams;
  const query = normalizeQuery(rawQuery);
  const tab = parseSearchTab(rawType);
  const searching = isSearchable(query);

  const user = await getCurrentUser();
  const viewerId = user?.id ?? null;

  const [posts, people, suggestions] = await Promise.all([
    searching && tab === "posts" ? searchPosts({ query, viewerId }) : null,
    searching && tab === "people" ? searchPeople(query, viewerId) : null,
    searching ? null : fetchSuggestions(viewerId, 12),
  ]);

  const viewer = toClientViewer(user);

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <SearchBox query={query} tab={tab} />

      {searching && (
        <nav aria-label="Search results" className="glass-bar flex gap-1 rounded-ctl p-1">
          {SEARCH_TABS.map((t) => (
            <Link
              key={t.key}
              href={searchHref(query, t.key)}
              scroll={false}
              aria-current={tab === t.key ? "page" : undefined}
              className={`flex-1 rounded-[10px] py-2 text-center text-sm font-medium transition-colors ${
                tab === t.key ? "bg-panel-3 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {posts && (
        <SearchPosts
          initialPosts={posts.posts.map(toClientPost)}
          initialCursor={posts.nextCursor}
          query={query}
          viewer={viewer}
        />
      )}

      {people && (
        <SearchPeople
          initialPeople={people.people}
          initialCursor={people.nextCursor}
          query={query}
        />
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="panel divide-y divide-line shadow-card">
          {suggestions.map((person) => (
            <li key={person.id}>
              <PersonRow person={person} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
