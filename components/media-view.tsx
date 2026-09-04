import type { ClientPost } from "@/lib/types";
import { MediaPlayer } from "./media-player";
import { ViewableImage } from "./photo-viewer";

/**
 * Renders whatever the post actually is.
 *
 * Media comes from `/api/media/[key]`, which decrypts from the disk cache (or
 * pulls the ciphertext back from the archive on a miss) and answers with
 * immutable cache headers. Images are a plain `img`: the bytes are already
 * normalised to a sane size and format by the upload pipeline, so putting the
 * image optimizer in front would mean decrypting and re-encoding the same frame
 * again per width, for nothing.
 *
 * An image is also a tap away from filling the screen — the evidence here is mostly
 * screenshots, and a screenshot boxed into 70vh of a feed is one you cannot read.
 *
 * Video and audio go through {@link MediaPlayer} rather than carrying `controls`,
 * so the bar is the app's rather than the browser's.
 */
export function MediaView({ post }: { post: ClientPost }) {
  const ratio =
    post.width && post.height ? `${post.width} / ${post.height}` : undefined;

  if (post.kind === "TWEET" && !post.mediaUrl) {
    return (
      <blockquote className="mx-4 mb-4 rounded-ctl border border-line bg-panel-2 px-4 py-4 text-[15px] leading-relaxed text-ink">
        <span className="mr-1 select-none text-faint">“</span>
        {post.tweetText}
        <span className="ml-0.5 select-none text-faint">”</span>
      </blockquote>
    );
  }

  if (!post.mediaUrl) return null;

  if (post.kind === "AUDIO") {
    return (
      <MediaPlayer
        kind="AUDIO"
        src={post.mediaUrl}
        className="mx-4 mb-4 rounded-ctl border border-line bg-panel-2 px-2 py-2"
      />
    );
  }

  if (post.kind === "VIDEO") {
    return (
      <MediaPlayer
        kind="VIDEO"
        src={post.mediaUrl}
        poster={post.posterUrl}
        aspectRatio={ratio}
        className="mb-3"
      />
    );
  }

  return (
    <div className="mb-3 bg-black" style={{ aspectRatio: ratio }}>
      <ViewableImage
        src={post.mediaUrl}
        alt={post.caption ?? "Submitted bakchodi"}
        width={post.width ?? undefined}
        height={post.height ?? undefined}
        loading="lazy"
        wrapClassName="w-full"
        className="max-h-[70vh] w-full object-contain"
      />
    </div>
  );
}
