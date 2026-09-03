import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchFeed,
  fetchPinnedPost,
  fetchProfile,
  toClientPost,
  toClientProfile,
  toClientViewer,
} from "@/lib/posts";
import { resolveHandleRedirect } from "@/lib/identity";
import { fetchFollowState } from "@/lib/follows";
import { visibilityAllows } from "@/lib/profile";
import { fetchAuthorStories, fetchHighlights } from "@/lib/stories";
import { Avatar } from "@/components/avatar";
import { Feed } from "@/components/feed";
import { HighlightRow } from "@/components/highlight-row";
import { PostCard } from "@/components/post-card";
import { ProfileHeader } from "@/components/profile-header";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { WelcomeFrame } from "@/components/welcome-frame";
import { LockIcon, PinIcon } from "@/components/icons";

/**
 * A person's profile: who they are, what the crowd scored them, and everything
 * they have posted.
 *
 * Rendered on the server apart from the feed, the intro frame and the highlight row.
 * The banner, name, tagline, bio, links and join date all live in `ProfileHeader`;
 * what this file adds inside it is the stats, the intro and the highlights.
 *
 * `visibility: SIGNED_IN` is enforced here *and* in `GET /api/posts?author=`. Doing
 * it in only one of the two would leave the API as a way to walk around the page.
 */

export async function generateMetadata(
  props: PageProps<"/u/[handle]">,
): Promise<Metadata> {
  const { handle } = await props.params;
  const row = await fetchProfile(decodeURIComponent(handle));
  if (!row) return { title: "No such bakchod" };

  // A signed-in-only profile still has a title — the name and score are public
  // everywhere else on the site — but it is kept out of search results.
  const isPrivate = row.theme?.visibility === "SIGNED_IN";

  return {
    title: `${row.displayName} (@${row.handle}) — Rate the Bakchod`,
    description: row.isAI
      ? "The house bakchod. Posts, roasts, and is never scored."
      : row.ratingsCount > 0
        ? `Bakchod score ${row.bakchodScore.toFixed(2)} across ${row.ratingsCount} ratings.`
        : "Not rated yet.",
    ...(isPrivate ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function ProfilePage(props: PageProps<"/u/[handle]">) {
  const { handle } = await props.params;
  const asked = decodeURIComponent(handle);
  const row = await fetchProfile(asked);
  if (!row) {
    // Before 404ing: the handle may have been renamed out from under this link.
    // A permanent redirect means every share, bookmark and search result that
    // predates the rename keeps landing on the right person.
    const current = await resolveHandleRedirect(asked);
    if (current) permanentRedirect(`/u/${encodeURIComponent(current)}`);
    notFound();
  }

  const user = await getCurrentUser();
  const viewer = toClientViewer(user);
  const isSelf = viewer?.id === row.id;
  const profile = toClientProfile(row, { isOwner: isSelf });

  // Owners are always allowed through their own gate.
  const allowed =
    isSelf || visibilityAllows(row.theme?.visibility ?? "PUBLIC", user?.id ?? null);

  if (!allowed) {
    return <PrivateCard displayName={profile.displayName} handle={profile.handle} />;
  }

  const [page, highlights, live, pinned, follow] = await Promise.all([
    fetchFeed({ tab: "fresh", authorHandle: profile.handle, viewerId: user?.id ?? null }),
    fetchHighlights(profile.id),
    fetchAuthorStories(profile.handle, user?.id ?? null),
    row.theme?.pinnedPostId
      ? fetchPinnedPost(row.theme.pinnedPostId, profile.id, user?.id ?? null)
      : null,
    fetchFollowState(profile.id, user?.id ?? null),
  ]);

  const author = {
    id: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    isAI: profile.isAI,
    bakchodScore: profile.bakchodScore,
  };

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <ProfileHeader profile={profile} isSelf={isSelf} follow={follow}>
        {profile.theme?.welcome && (
          <div className="border-t border-line px-4 py-3.5 sm:px-5">
            <WelcomeFrame
              src={profile.theme.welcome.url}
              handle={profile.handle}
              displayName={profile.displayName}
              autoDismissMs={profile.theme.welcome.autoDismissMs}
            />
          </div>
        )}

        <HighlightRow
          highlights={highlights}
          author={author}
          selfHandle={viewer?.handle ?? null}
          live={live}
        />

        <dl className="flex flex-wrap gap-x-7 gap-y-3 border-t border-line px-4 py-3.5 sm:px-5">
          <Stat
            label="Bakchod score"
            value={
              profile.isAI
                ? "Never scored"
                : profile.ratingsCount > 0
                  ? profile.bakchodScore.toFixed(2)
                  : "Unrated"
            }
            lead={!profile.isAI && profile.ratingsCount > 0}
          />
          {!profile.isAI && (
            <Stat
              label="Ratings"
              value={String(profile.ratingsCount)}
              hint={profile.average !== null ? `avg ${profile.average.toFixed(1)}` : undefined}
            />
          )}
          <Stat label="Posts" value={String(profile.postsCount)} />
          <Stat label="Comments" value={String(profile.commentsCount)} />
          {/* Null means the owner switched this stat off, so the number never left
              the server. Absent, not blanked. */}
          {!profile.isAI && profile.ratingsGiven !== null && (
            <Stat label="Ratings given" value={String(profile.ratingsGiven)} />
          )}
        </dl>
      </ProfileHeader>

      {pinned && (
        <section>
          <h2 className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <PinIcon className="h-3.5 w-3.5" />
            Pinned
          </h2>
          <PostCard post={toClientPost(pinned)} viewer={viewer} />
        </section>
      )}

      <h2 className="px-1 pt-1 text-sm font-semibold text-ink">
        {isSelf ? "Your bakchodi" : `Bakchodi by ${profile.displayName}`}
      </h2>

      <Feed
        initialPosts={page.posts.map(toClientPost)}
        initialCursor={page.nextCursor}
        tab="fresh"
        viewer={viewer}
        author={profile.handle}
      />
    </div>
  );
}

/**
 * What a signed-out visitor sees on a `SIGNED_IN` profile.
 *
 * Name and handle only. The score is deliberately absent here even though it is
 * public on the leaderboard — this card's job is to explain the wall, not to be a
 * smaller way through it.
 */
function PrivateCard({
  displayName,
  handle,
}: {
  displayName: string;
  handle: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[640px]">
      <section className="panel px-5 py-8 text-center shadow-card">
        <span className="mx-auto flex w-fit">
          <Avatar src={null} name={displayName} size={64} />
        </span>
        <h1 className="mt-3 text-lg font-bold text-ink">{displayName}</h1>
        <p className="mt-0.5 text-sm text-muted">@{handle}</p>
        <p className="mx-auto mt-4 flex max-w-[320px] items-start gap-2 text-left text-xs leading-relaxed text-faint">
          <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This profile is only shown to people who are signed in.
        </p>
        <SignInPrompt className="mt-4 justify-center" size="xs">
          Sign in to see it.
        </SignInPrompt>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  lead = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** The one stat that carries the row. Full-strength ink; the rest sit back in muted. */
  lead?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">
        {label}
      </dt>
      <dd
        className={`text-[17px] font-bold tabular-nums ${
          lead ? "text-ink" : "text-muted"
        }`}
      >
        {value}
        {hint && (
          <span className="ml-1.5 text-[11px] font-medium text-faint">{hint}</span>
        )}
      </dd>
    </div>
  );
}
