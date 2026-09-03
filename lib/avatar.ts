import "server-only";

/**
 * Where a person's picture comes from.
 *
 * Its own module, and a leaf one — it imports nothing from the rest of `lib`.
 * That is the whole point: `lib/posts.ts` used to be the home for these three,
 * and everything that renders a person reached into it for them. Once posts
 * started notifying people, `lib/notifications.ts` needed the same helper and
 * `lib/posts.ts` needed `notify`, which is a cycle. Splitting the leaf out breaks
 * it without touching any call site — `lib/posts.ts` re-exports all three.
 */

export function profileAssetUrl(key: string | null): string | null {
  return key ? `/api/profile-asset/${key}` : null;
}

/**
 * A row carrying both places a person's picture can come from.
 *
 * `theme` is optional so a plain `User` still satisfies it — but a select that
 * leaves it out silently falls back to the Google picture, which is exactly the
 * bug this type exists to prevent a repeat of. Any new author select needs
 * `theme: { select: { logoKey: true } }` beside `avatarUrl`.
 */
export interface AvatarSource {
  avatarUrl: string | null;
  theme?: { logoKey: string | null } | null;
}

/**
 * The picture that stands for a person anywhere in the app.
 *
 * An uploaded profile picture wins over the one Google supplied at sign-in. It is
 * resolved here, once, rather than at each render, because the two live on
 * different tables — `User.avatarUrl` and `ProfileTheme.logoKey` — and every
 * component that reached for only the first went on showing the old picture.
 */
export function resolveAvatarUrl(row: AvatarSource): string | null {
  return profileAssetUrl(row.theme?.logoKey ?? null) ?? row.avatarUrl;
}
