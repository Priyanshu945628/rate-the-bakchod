import { getCurrentUser } from "@/lib/auth";
import { parseTab } from "@/lib/feed-tabs";
import { fetchSuggestions } from "@/lib/follows";
import { fetchFeed, fetchLeaderboard, toClientPost, toClientViewer } from "@/lib/posts";
import { fetchStoryTrays } from "@/lib/stories";
import { Composer } from "@/components/composer";
import { Feed } from "@/components/feed";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { StoryTray } from "@/components/story-tray";
import { SuggestedPeople } from "@/components/suggested-people";

export default async function HomePage(props: PageProps<"/">) {
  const { tab: rawTab } = await props.searchParams;
  const user = await getCurrentUser();

  // The default depends on who is asking: a signed-in visitor has a graph to
  // blend, so For You is their feed; signed out there is nothing to blend and
  // Fresh is the only honest answer.
  const tab = parseTab(rawTab, user ? "foryou" : "fresh");

  const [page, board, trays, suggestions] = await Promise.all([
    fetchFeed({ tab, viewerId: user?.id ?? null }),
    fetchLeaderboard(10),
    fetchStoryTrays(user?.id ?? null),
    fetchSuggestions(user?.id ?? null),
  ]);

  const viewer = toClientViewer(user);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-3">
      <div className="min-w-0 flex-1 space-y-3 xl:max-w-[640px]">
        <StoryTray trays={trays} viewer={viewer} />
        <Composer viewer={viewer} />
        <Feed
          initialPosts={page.posts.map(toClientPost)}
          initialCursor={page.nextCursor}
          tab={tab}
          viewer={viewer}
        />
      </div>

      <aside className="hidden w-[340px] shrink-0 xl:block">
        <div className="sticky top-[80px] space-y-3">
          <LeaderboardPanel rows={board} />
          <SuggestedPeople people={suggestions} />
        </div>
      </aside>
    </div>
  );
}
