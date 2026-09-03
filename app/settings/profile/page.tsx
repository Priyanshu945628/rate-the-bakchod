import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchOwnerTheme } from "@/lib/profile";
import { fetchHighlights, fetchStoryArchive } from "@/lib/stories";
import { fetchFeed, toClientPost } from "@/lib/posts";
import { ProfileSettings } from "@/components/settings/profile-settings";
import type { PinCandidate } from "@/components/settings/pinned-section";

export const metadata: Metadata = {
  title: "Profile settings · Rate the Bakchod",
  robots: { index: false, follow: false },
};

/**
 * Everything you can change about how your profile looks and who can see it.
 *
 * All four reads happen here rather than in the client, so the editor opens already
 * populated — a settings page that flashes empty fields and then fills them in reads
 * as broken even when it isn't.
 */
export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  // Not a redirect to sign-in: this URL means nothing without an account, and 404 is
  // the same answer the admin page gives.
  if (!user) notFound();

  const [theme, highlights, archive, page] = await Promise.all([
    fetchOwnerTheme(user.id),
    fetchHighlights(user.id),
    fetchStoryArchive(user.id),
    // Your own recent posts, for the pin picker. `fetchFeed` already excludes
    // stories and hidden posts, which is exactly the set a pin may point at.
    fetchFeed({ tab: "fresh", authorHandle: user.handle, viewerId: user.id }),
  ]);

  const pinCandidates: PinCandidate[] = page.posts.map(toClientPost).map((post) => ({
    id: post.id,
    kind: post.kind,
    caption: post.caption ?? post.tweetText,
    thumbUrl: post.posterUrl ?? (post.kind === "IMAGE" ? post.mediaUrl : null),
    createdAt: post.createdAt,
  }));

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <header className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-ink">Your profile</h1>
        </div>
        {/* The way back. This page is reached from the profile now, not from the
            navigation, so it has to offer the return trip itself. */}
        <Link
          href={`/u/${encodeURIComponent(user.handle)}`}
          className="flex h-9 shrink-0 items-center rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          View profile
        </Link>
      </header>

      <ProfileSettings
        handle={user.handle}
        displayName={user.displayName}
        initialTheme={theme}
        initialHighlights={highlights}
        initialArchive={archive}
        pinCandidates={pinCandidates}
      />
    </div>
  );
}
