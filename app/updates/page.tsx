import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { fetchOfficialPosts, toClientPost, toClientViewer } from "@/lib/posts";
import { PostCard } from "@/components/post-card";

export const metadata: Metadata = {
  title: "Updates · Rate the Bakchod",
};

/**
 * Every platform update in one place.
 *
 * The same posts the feed already carried, collected — this is where the Official
 * badge on a card links to. Admins write them at `/admin/updates`.
 */
export default async function UpdatesPage() {
  const [user, posts] = await Promise.all([getCurrentUser(), fetchOfficialPosts()]);
  const viewer = toClientViewer(user);

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-ink">Updates</h1>
      </header>

      {posts.length === 0 ? (
        <p className="panel px-4 py-8 text-center text-sm text-muted shadow-card">
          Nothing yet.
        </p>
      ) : (
        posts.map((post) => (
          <PostCard key={post.id} post={toClientPost(post)} viewer={viewer} />
        ))
      )}
    </div>
  );
}
