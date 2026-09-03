import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchPostWithComments, toClientPost, toClientViewer } from "@/lib/posts";
import { fetchPrivacy, visibilityAllows } from "@/lib/profile";
import { PostCard } from "@/components/post-card";
import { ChevronLeftIcon } from "@/components/icons";

/**
 * One post on its own page.
 *
 * This exists because every notification needs somewhere to go. A rating, a
 * comment, a mention and an AI roast all point at a post, and before this route
 * there was no URL for one — the thread was only reachable by expanding a card in
 * a feed you had to find first.
 *
 * The thread comes down with the page rather than being fetched on open, which is
 * the opposite of the feed's behaviour and deliberate: here the comment *is* the
 * reason you clicked.
 */

export async function generateMetadata(props: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const post = await fetchPostWithComments(id);
  if (!post) return { title: "Gone — Rate the Bakchod" };

  const privacy = await fetchPrivacy(post.author.handle);
  const isPrivate = privacy?.visibility === "SIGNED_IN";

  return {
    title: `${post.author.displayName} on Rate the Bakchod`,
    description:
      post.caption ??
      post.tweetText ??
      (post.ratingsCount > 0
        ? `Rated ${(post.ratingsSum / post.ratingsCount).toFixed(1)} by ${post.ratingsCount} people.`
        : "Not rated yet."),
    ...(isPrivate ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function PostPage(props: PageProps<"/p/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const post = await fetchPostWithComments(id, user?.id ?? null);
  if (!post) notFound();

  // The author's profile gate covers their posts too. A `SIGNED_IN` profile whose
  // posts were readable one URL over would not be private at all — and a 404 is
  // the right answer rather than a wall, because the wall would confirm the post
  // exists.
  const privacy = await fetchPrivacy(post.author.handle);
  if (
    privacy &&
    post.author.id !== user?.id &&
    !visibilityAllows(privacy.visibility, user?.id ?? null)
  ) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <Link
        href={`/u/${encodeURIComponent(post.author.handle)}`}
        className="flex w-fit items-center gap-1.5 px-1 text-xs font-medium text-muted transition-colors hover:text-ink"
      >
        <ChevronLeftIcon className="h-3.5 w-3.5" />@{post.author.handle}
      </Link>

      <PostCard post={toClientPost(post)} viewer={toClientViewer(user)} openComments />
    </div>
  );
}
