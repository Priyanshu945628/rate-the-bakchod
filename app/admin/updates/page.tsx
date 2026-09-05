import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchOfficialPosts, toClientPost, toClientViewer } from "@/lib/posts";
import { Composer } from "@/components/composer";
import { PostCard } from "@/components/post-card";

export const metadata: Metadata = {
  title: "Updates · Rate the Bakchod",
  robots: { index: false, follow: false },
};

/**
 * Where platform updates are written.
 *
 * An update is an ordinary post — same feed, same permalink, same encrypted upload
 * path, same archive — carrying `isOfficial`, which badges the card and takes rating
 * off it. Nothing here is a second kind of content: the point is an announcement
 * that lands in the feed people already read, rather than a changelog nobody opens.
 *
 * The cards below are the real {@link PostCard}, so edit, pin, copy-link and delete
 * are the same controls as anywhere else. `/updates` is the public copy of the list.
 */
export default async function AdminUpdatesPage() {
  const user = await getCurrentUser();
  // Same reasoning as `/admin`: straight home, because nobody who is not an admin
  // has any business learning that this page exists.
  if (!user?.isAdmin) redirect("/");

  const posts = await fetchOfficialPosts();
  const viewer = toClientViewer(user);

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Updates</h1>
        <Link
          href="/admin"
          className="text-sm text-muted transition-colors hover:text-ink"
        >
          Moderation
        </Link>
        <Link
          href="/admin/bot"
          className="text-sm text-muted transition-colors hover:text-ink"
        >
          Bot
        </Link>
        <Link
          href="/updates"
          className="ml-auto text-sm text-muted transition-colors hover:text-ink"
        >
          Public page
        </Link>
      </header>

      <Composer viewer={viewer} official />

      {posts.map((post) => (
        <PostCard key={post.id} post={toClientPost(post)} viewer={viewer} />
      ))}
    </div>
  );
}
