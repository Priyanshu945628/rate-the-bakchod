/**
 * Validation for everything a user can change about their own profile.
 *
 * Deliberately NOT `server-only`: the settings form imports these same schemas
 * so the browser and the API agree on what is valid. The API is still the only
 * authority — the client copy exists to give instant feedback, not to be trusted.
 *
 * Note on `welcomeHtml`: there is no sanitiser here, and that is the design, not
 * an omission. The HTML is never interpolated into a page — it is served as its
 * own document with an opaque origin (see `lib/welcome-doc.ts`), where a script
 * can do whatever it likes and still reach nothing. Stripping tags would only
 * break people's animations while adding no security we don't already have.
 */

import { z } from "zod";
import { limits } from "@/lib/config";

/** Flat six-digit hex. Three-digit shorthand is rejected so storage is uniform. */
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Characters a handle may use. Lowercase letters, digits and underscore only —
 * no spaces, no dots, no hyphen, so a handle can never be confused with a URL
 * path segment or a display name.
 */
export const HANDLE_RE = /^[a-z0-9_]+$/;

/**
 * Handles nobody may claim, whatever the reservation state says. Mix of route
 * names that would shadow a real page and names that would let someone pose as
 * the platform itself.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "auth",
  "ai",
  "bakchod",
  "feed",
  "home",
  "leaderboard",
  "login",
  "log",
  "messages",
  "message",
  "notifications",
  "p",
  "profile",
  "settings",
  "signin",
  "signup",
  "stories",
  "u",
  "www",
]);

/**
 * The name shown everywhere. No forbidden characters, and not literally "AI" or
 * "House AI" — those names belong to the house account and a stranger taking
 * them would read as the platform speaking.
 */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Give yourself a name.")
  .max(limits.displayNameMaxLength, `Keep the name under ${limits.displayNameMaxLength} characters.`)
  .transform((v) => v.replace(/\s+/g, " "))
  .refine((v) => v.toLowerCase() !== "ai" && v.toLowerCase() !== "house ai", {
    message: "That name belongs to the house bakchod.",
  });

/**
 * The @handle. Everything is lowercase by construction: the regex excludes
 * capitals, so the natural thing to hang a URL on is also the thing that makes
 * lookups trivially case-insensitive.
 */
export const HandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(limits.handleMinLength, `Handles are at least ${limits.handleMinLength} characters.`)
  .max(limits.handleMaxLength, `Handles max ${limits.handleMaxLength} characters.`)
  .regex(HANDLE_RE, "Lowercase letters, numbers and underscore only.")
  .refine((v) => !RESERVED_HANDLES.has(v), {
    message: "That handle is reserved.",
  });

/**
 * The only schemes a profile link may use. An allowlist, not a blocklist —
 * `javascript:`, `data:`, `vbscript:`, `blob:` and every scheme invented next
 * year are all excluded by simply not being here.
 */
export const ALLOWED_LINK_SCHEMES = ["http:", "https:"] as const;

/** UTF-8 byte length. The DB column is measured in bytes, so this must be too. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * True when `raw` is a link we are willing to render for visitors.
 *
 * Exported separately from the schema so it can be tested directly, and so the
 * rules are readable in one place rather than buried in a `refine` chain.
 */
export function isSafeLinkUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // relative or malformed — a profile link must be absolute
  }
  if (!(ALLOWED_LINK_SCHEMES as readonly string[]).includes(url.protocol)) {
    return false;
  }
  // `https://paypal.com@evil.example` renders as PayPal in a lot of UIs. No.
  if (url.username || url.password) return false;
  if (!url.hostname) return false;
  return true;
}

/** "" and "   " mean "clear this field", not "store whitespace". */
const blankToNull = (v: string) => {
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const taglineField = z
  .string()
  .max(limits.taglineMaxLength, `Keep the tagline under ${limits.taglineMaxLength} characters.`)
  .transform(blankToNull)
  .nullable();

const bioField = z
  .string()
  .max(limits.bioMaxLength, `Keep the bio under ${limits.bioMaxLength} characters.`)
  .transform(blankToNull)
  .nullable();

const accentField = z
  .string()
  .transform(blankToNull)
  .nullable()
  .refine((v) => v === null || HEX_RE.test(v), {
    message: "Accent must be a flat hex colour like #a89bd6.",
  });

const welcomeHtmlField = z
  .string()
  .transform(blankToNull)
  .nullable()
  .refine((v) => v === null || utf8Bytes(v) <= limits.welcomeHtmlMaxBytes, {
    message: `Welcome HTML must be under ${Math.round(limits.welcomeHtmlMaxBytes / 1024)} KB.`,
  });

export const ProfileLinkSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give the link a label.")
    .max(limits.linkLabelMaxLength, `Labels max ${limits.linkLabelMaxLength} characters.`),
  url: z
    .string()
    .trim()
    .max(limits.linkUrlMaxLength, "That URL is too long.")
    .refine(isSafeLinkUrl, { message: "Links must be a plain http:// or https:// address." }),
});

export const ProfileLinksSchema = z
  .array(ProfileLinkSchema)
  .max(limits.maxLinks, `At most ${limits.maxLinks} links.`);

export const VisibilitySchema = z.enum(["PUBLIC", "SIGNED_IN"]);

/** Who may open a DM with you. Enforced in `openConversation`, not in the UI. */
export const DmPolicySchema = z.enum(["EVERYONE", "FOLLOWERS", "NOBODY"]);

/**
 * The theme half of a PATCH body, as a bare shape.
 *
 * Kept as a plain object rather than a built schema because two schemas are made
 * from it below, and `.extend()` on an already-refined schema is the kind of
 * thing that quietly changes behaviour between Zod versions. Spreading a shape
 * cannot.
 */
const themePatchShape = {
  tagline: taglineField,
  bio: bioField,
  accent: accentField,

  welcomeHtml: welcomeHtmlField,
  welcomeEnabled: z.boolean(),
  welcomeMs: z
    .number()
    .int()
    .min(0)
    .max(limits.welcomeMaxMs, `Auto-dismiss must be under ${limits.welcomeMaxMs / 1000}s.`),
  welcomePreset: z.string().trim().max(40).transform(blankToNull).nullable(),

  links: ProfileLinksSchema.nullable(),
  pinnedPostId: z.string().trim().min(1).max(64).nullable(),

  visibility: VisibilitySchema,
  storiesVisibility: VisibilitySchema,
  showRatingsGiven: z.boolean(),
  showJoinDate: z.boolean(),
  allowComments: z.boolean(),
  dmPolicy: DmPolicySchema,
};

/** Rejects `{}`, so a malformed body cannot read as a successful no-op save. */
const notEmpty = (patch: object) => Object.keys(patch).length > 0;

/**
 * A PATCH body. Every field is optional: the settings page sends one section at
 * a time, and an absent key means "leave it alone" while an explicit `null`
 * means "clear it". `bannerKey` / `logoKey` are absent on purpose — those are
 * only ever set by the upload route, so this endpoint cannot be used to point a
 * profile at somebody else's asset.
 */
export const ThemePatchSchema = z
  .object(themePatchShape)
  .partial()
  .refine(notEmpty, { message: "Nothing to update." });

export const HighlightTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the highlight a title.")
  .max(limits.highlightTitleMaxLength, `Titles max ${limits.highlightTitleMaxLength} characters.`);

/**
 * The whole /api/profile PATCH body. Theme fields plus the two identity fields.
 *
 * Identity is its own concern — `renameIdentity` owns the transaction, the
 * cooldown and the reservation — but it ships in the same request as the theme
 * save, because the settings page saves one draft in one request. An absent key
 * on either side still means "leave it alone".
 */
export const ProfilePatchSchema = z
  .object({
    ...themePatchShape,
    displayName: DisplayNameSchema,
    handle: HandleSchema,
  })
  .partial()
  .refine(notEmpty, { message: "Nothing to update." });
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/**
 * The welcome-preview endpoint takes just the two things the frame renders.
 *
 * The byte cap is deliberately looser than the stored one (`× 4`): a draft that is
 * slightly too long should preview and then be refused on save with a message
 * about its size, rather than silently failing to preview at all. The multiplier
 * still bounds the request. The accent is checked here and re-checked by
 * `buildWelcomeDoc`, so a malformed one can never reach a style block.
 */
export const WelcomePreviewSchema = z.object({
  html: z.string().max(limits.welcomeHtmlMaxBytes * 4),
  accent: z
    .string()
    .regex(HEX_RE, "Accent must be a flat hex colour like #a89bd6.")
    .nullish(),
});

export type ProfileLink = z.infer<typeof ProfileLinkSchema>;
export type ThemePatch = z.infer<typeof ThemePatchSchema>;
export type VisibilityName = z.infer<typeof VisibilitySchema>;
export type DmPolicyName = z.infer<typeof DmPolicySchema>;
export type DisplayName = z.infer<typeof DisplayNameSchema>;
export type Handle = z.infer<typeof HandleSchema>;
