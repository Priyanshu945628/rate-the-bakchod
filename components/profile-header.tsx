import Link from "next/link";
import type { ClientFollowState, ClientProfile } from "@/lib/types";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";
import { LinkIcon, SparkIcon, VerifiedIcon } from "./icons";
import { MessageButton } from "./message-button";

/**
 * The decorated top of a profile: banner, picture, name, tagline, bio, link row.
 *
 * The accent colour arrives as an inline `--accent` custom property on the root
 * element here, and every accented class below reads that variable. Two consequences
 * worth stating: a user's colour can never leak into the chrome around the profile,
 * and it can never be anything but a validated `#rrggbb` — `saveTheme` checks the
 * hex on write and the header falls back to `ink` when it is absent. Flat fills
 * only; the standing rule against gradients holds here as much as anywhere.
 *
 * Note that `--accent` (the profile owner's colour) and `--color-accent` (the app's
 * own accent, which is white) are deliberately different variables. A user's choice
 * decorates their own header; it never becomes the app's accent.
 *
 * On your own profile this is also the way in to the editor. There is no separate
 * settings destination in the navigation: the place you change how your profile
 * looks is the profile, where you can see what you are changing.
 */

interface ProfileHeaderProps {
  profile: ClientProfile;
  isSelf: boolean;
  /** Counts and the viewer's edge. The follow button draws itself from this. */
  follow: ClientFollowState;
  /** Rendered under the identity block — the welcome frame and the stats live there. */
  children?: React.ReactNode;
}

const joined = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function ProfileHeader({
  profile,
  isSelf,
  follow,
  children,
}: ProfileHeaderProps) {
  const theme = profile.theme;
  const accent = theme?.accent ?? null;
  const hasBanner = Boolean(theme?.bannerUrl);

  return (
    <section
      className="panel overflow-hidden shadow-card"
      // Only set when there is a colour, so the stylesheet's own `--accent` stays
      // in force for a stock profile rather than being overwritten with a copy.
      style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
    >
      {theme?.bannerUrl && (
        <div className="h-32 w-full bg-panel-2 sm:h-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={theme.bannerUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Two layouts, not one with margin tricks: with a banner the picture sits on
          its own row, pulled up so it straddles the seam; without one it sits beside
          the name the way the rest of the app arranges an avatar and a title. */}
      <div
        className={
          hasBanner
            ? "px-4 pb-5 sm:px-5"
            : "flex items-start gap-4 px-4 py-5 sm:px-5"
        }
      >
        <div
          className={
            hasBanner ? "-mt-10 mb-2.5 w-fit rounded-full bg-panel p-1" : undefined
          }
        >
          <Avatar
            // Already resolved server-side — an uploaded picture beats the one
            // Google gave us, and it beats it everywhere, not just here.
            src={profile.avatarUrl}
            name={profile.displayName}
            size={72}
            isAI={profile.isAI}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-bold text-ink">{profile.displayName}</h1>
            {profile.isAI && (
              <span className="flex items-center gap-1 rounded-pill border border-line-strong bg-panel-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                <SparkIcon className="h-3 w-3" />
                AI
              </span>
            )}
            {/* A mark on the name, not a pill beside it. A pill is another thing in
                the row competing with the name for the eye; the badge is the same
                grammar every platform already uses, and it reads at a glance. The
                app's own accent, never the profile owner's — this is authority the
                platform granted, not decoration its owner chose. */}
            {profile.isAdmin && (
              <span
                title="Moderator"
                aria-label="Moderator"
                role="img"
                className="-ml-0.5 flex shrink-0 items-center text-accent"
              >
                <VerifiedIcon className="h-4 w-4" />
              </span>
            )}
            {/* This replaces the old "You" pill. A button that says what it does
                is a better marker of "this one is yours" than a label was, and it
                is the only entry point to the editor now. On someone else's
                profile the same slot is Message and the follow button. */}
            {isSelf ? (
              <Link
                href="/settings/profile"
                className="ml-auto flex h-8 shrink-0 items-center rounded-pill border border-line px-3 text-xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                Edit profile
              </Link>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {/* `isFollowing === null` is the header's only signal that nobody is
                    signed in, and the house account does not take messages. */}
                {follow.isFollowing !== null && !profile.isAI && (
                  <MessageButton handle={profile.handle} />
                )}
                <FollowButton
                  handle={profile.handle}
                  isFollowing={follow.isFollowing}
                  size="sm"
                />
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-sm text-muted">@{profile.handle}</p>

          {/* Counts under the handle rather than in the stats row below: these two
              are navigation, and the stats are numbers you read. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px]">
            <Link
              href={`/u/${profile.handle}/followers`}
              className="text-muted transition-colors hover:text-ink"
            >
              <span className="font-bold tabular-nums text-ink">
                {follow.followersCount}
              </span>{" "}
              {follow.followersCount === 1 ? "follower" : "followers"}
            </Link>
            <Link
              href={`/u/${profile.handle}/following`}
              className="text-muted transition-colors hover:text-ink"
            >
              <span className="font-bold tabular-nums text-ink">
                {follow.followingCount}
              </span>{" "}
              following
            </Link>
          </p>

          {theme?.tagline && (
            <p
              className="mt-1.5 text-[13px] font-semibold"
              // A colour the owner chose, or plain `ink`. Explicitly *not* the
              // theme accent: a stock profile should not spend the app's one
              // accent on a tagline, and the fallback is what a stock profile
              // gets.
              style={{ color: "var(--accent, var(--color-ink))" }}
            >
              {theme.tagline}
            </p>
          )}

          {/* `whitespace-pre-line` because a bio is typed with line breaks and
              losing them turns a three-line joke into a paragraph. */}
          {theme?.bio && (
            <p className="mt-1.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink/90">
              {theme.bio}
            </p>
          )}

          {profile.joinedAt && (
            <p className="mt-1.5 text-xs text-faint">
              Joined {joined.format(new Date(profile.joinedAt))}
            </p>
          )}

          {theme && theme.links.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {theme.links.map((link) => (
                <li key={link.url}>
                  {/* `ugc` and `nofollow` say what this is to a crawler; `noopener`
                      and no referrer are what stop the destination learning where
                      its traffic came from or reaching back into this tab. */}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer ugc"
                    className="flex h-7 items-center gap-1.5 rounded-pill border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    <LinkIcon className="h-3 w-3" />
                    <span className="max-w-[160px] truncate">{link.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {children}
    </section>
  );
}
