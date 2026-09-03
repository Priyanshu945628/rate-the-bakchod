import { SparkIcon } from "./icons";

/**
 * Round avatar with an initial fallback.
 *
 * These are 32–40px remote OAuth images. `next/image` would route each one
 * through the optimizer for no visible gain, so they are plain `img` tags on
 * purpose — no remotePatterns config, no extra hop.
 *
 * The AI's spark is not a fallback. Nobody can log in as the house account, so it
 * will never have a picture of its own, and it is drawn at full ink strength to look
 * like the mark it is rather than an image that failed to load.
 */

interface AvatarProps {
  src: string | null;
  name: string;
  size?: number;
  isAI?: boolean;
}

export function Avatar({ src, name, size = 40, isAI = false }: AvatarProps) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-panel-3 text-muted"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : isAI ? (
        <SparkIcon className="h-1/2 w-1/2 text-ink" />
      ) : (
        <span className="font-semibold">{initial}</span>
      )}
    </span>
  );
}
