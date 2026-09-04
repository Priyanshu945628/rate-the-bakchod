/**
 * Runtime configuration. Server-only values are read lazily so that importing
 * this module from a client bundle can never leak a secret, and so a missing
 * optional key degrades gracefully instead of crashing the whole app.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Public — safe to reference from client components. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

export const serverEnv = {
  get mediaMasterKey() {
    return required("MEDIA_MASTER_KEY");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },

  /**
   * Where the three writable directories live: the plaintext cache, the upload
   * spool, and the disk driver's store.
   *
   * One knob rather than three because a host gives you one persistent volume per
   * service, mounted at one path. Locally there is nothing to configure — the repo
   * root is where these already were. In a container the filesystem is wiped on
   * every deploy, and two of the three cannot survive that: the spool is the only
   * copy of ciphertext the archive has not accepted yet, and the cache is the only
   * servable copy of media until it has. Point this at the volume.
   */
  get dataDir(): string {
    return optional("DATA_DIR") ?? process.cwd();
  },

  /** "archive" (default) or "disk" for offline development. */
  get storageDriver(): "archive" | "disk" {
    const d = process.env.STORAGE_DRIVER ?? "archive";
    if (d !== "archive" && d !== "disk") {
      throw new Error(`STORAGE_DRIVER must be "archive" or "disk", got "${d}".`);
    }
    return d;
  },

  get archive() {
    return {
      accessKey: required("IA_ACCESS_KEY"),
      secretKey: required("IA_SECRET_KEY"),
      /** Item identifiers are prefixed with this, keeping uploads grouped. */
      itemPrefix: process.env.IA_ITEM_PREFIX ?? "rtb-media",
    };
  },

  /** Anthropic key is genuinely optional — the bot falls back to canned lines. */
  get anthropicKey() {
    return optional("ANTHROPIC_API_KEY");
  },
  get bakchodModel() {
    // Default per Anthropic guidance. Set BAKCHOD_MODEL=claude-haiku-4-5 for
    // the cheaper tier — note there is no date suffix on that id.
    return process.env.BAKCHOD_MODEL ?? "claude-opus-5";
  },

  /**
   * A TURN relay for calls, if one has been paid for.
   *
   * Optional deliberately. STUN gets most pairs of browsers talking directly, and the
   * pairs it cannot are behind the sort of NAT that only a relay can cross — but a
   * relay carries the whole call, which is bandwidth someone is billed for. Absent,
   * calls between two awkward networks fail to connect; they never fail to be offered.
   */
  get turn() {
    const url = optional("TURN_URL");
    if (!url) return null;
    return {
      url,
      username: optional("TURN_USERNAME"),
      credential: optional("TURN_CREDENTIAL"),
    };
  },
};

/** Media limits. Kept together so they are easy to tune in one place. */
export const limits = {
  maxUploadBytes: 100 * 1024 * 1024, // 100 MB accepted at the door
  maxVideoDurationMs: 60_000,
  maxAudioDurationMs: 300_000,
  maxImageEdge: 1600, // px, longest side after normalisation
  captionMaxLength: 500,
  /** Pasted tweet text on a TWEET post — the composer's limit and the editor's. */
  tweetMaxLength: 600,
  commentMaxLength: 600,
  /** Disk cache ceiling; least-recently-used entries are evicted past this. */
  cacheMaxBytes: 2 * 1024 * 1024 * 1024, // 2 GB

  // ── Profile customisation ────────────────────────────────────────────────
  taglineMaxLength: 80,
  bioMaxLength: 300,
  /**
   * Welcome-splash HTML ceiling. Measured in UTF-8 bytes, not characters, so
   * the DB's VarChar(16384) can never be overflowed by multi-byte input.
   */
  welcomeHtmlMaxBytes: 16 * 1024,
  maxLinks: 4,
  linkLabelMaxLength: 24,
  linkUrlMaxLength: 300,
  /** Auto-dismiss ceiling for the splash. 0 means wait for the visitor. */
  welcomeMaxMs: 20_000,
  bannerMaxEdge: 1600,
  logoMaxEdge: 256,
  highlightCoverMaxEdge: 320,
  /** Ceiling on what a banner/logo upload may weigh at the door. */
  profileAssetUploadMaxBytes: 20 * 1024 * 1024,
  /** Post-normalisation ceiling for a banner/logo/cover, checked after sharp. */
  profileAssetMaxBytes: 400 * 1024,

  // ── Stories ──────────────────────────────────────────────────────────────
  /**
   * How long a story stays in the tray. Stamped onto the row as `storyExpiresAt`
   * when it is created, so changing this moves the deadline for new stories only —
   * the ones already up keep the window they were posted under.
   *
   * Expiry is a filter, not a delete: the bytes survive so the owner can still
   * promote an expired story into a highlight, which is the one thing that makes
   * it permanent. See `lib/story-window.ts`.
   */
  storyTtlMs: 24 * 60 * 60 * 1000,
  highlightTitleMaxLength: 40,
  maxHighlights: 10,

  // ── Identity ─────────────────────────────────────────────────────────────
  /** Display names cap at the same length OAuth names are clamped to on create. */
  displayNameMaxLength: 60,
  handleMinLength: 3,
  handleMaxLength: 20,
  /** A freed handle stays reserved to its former owner for this long. */
  handleReservationDays: 30,
  /** How long after a rename before the owner may rename again. */
  handleCooldownDays: 14,

  // ── Messaging ────────────────────────────────────────────────────────────
  messageMaxLength: 4000,
  dmImageMaxEdge: 1600,
  dmImageMaxBytes: 400 * 1024,
  dmImageUploadMaxBytes: 20 * 1024 * 1024,

  // ── Calls ────────────────────────────────────────────────────────────────
  /**
   * How long a call rings before it counts as missed.
   *
   * The caller's own browser is what usually gives up and says so, but a tab that
   * closes mid-ring would leave the row RINGING forever and block both people from
   * calling again. So this is also read server-side, as the age at which a RINGING
   * row is swept to MISSED on the next attempt.
   */
  ringTimeoutMs: 45_000,
};

/** Rate limits, expressed as (max actions, window in seconds). */
export const rateLimits = {
  upload: { max: 5, windowSec: 3600 },
  rate: { max: 60, windowSec: 3600 },
  comment: { max: 20, windowSec: 3600 },
  report: { max: 10, windowSec: 86_400 },
  /** Theme/privacy edits. Generous — fiddling with your own profile is cheap. */
  profile: { max: 30, windowSec: 3600 },
  /** Image uploads are not cheap, so these are closer to the post limit. */
  profileAsset: { max: 10, windowSec: 3600 },
  story: { max: 20, windowSec: 3600 },
  /**
   * Marking stories seen. Its own bucket, and a big one: paging through the tray
   * fires one of these per story, so sharing the `story` budget would mean a busy
   * viewer could no longer post.
   */
  storyView: { max: 600, windowSec: 3600 },
  /** Follower edges. Following 30 strangers an hour is enough for anyone. */
  follow: { max: 30, windowSec: 3600 },
  /** Private messages — a fast talker, but not a firehose. */
  message: { max: 60, windowSec: 3600 },
  /** DM image uploads are as costly as post uploads, so share that shape. */
  messageAsset: { max: 10, windowSec: 3600 },
  /**
   * Ringing someone. Invites only — SDP and ICE are not metered, because a single
   * answered call is dozens of candidate exchanges and a budget that a normal call
   * can exhaust is a budget that breaks calling.
   */
  call: { max: 30, windowSec: 3600 },
  /**
   * Unfurling a pasted link. Metered because it is the one request in the app that
   * makes the server fetch an address a stranger chose, and the cost is not the
   * reader's to spend — the limit is per viewer, but the bandwidth is ours.
   *
   * High, because the meter counts *reads*, not links: the result is cached server
   * side and in the browser, so scrolling the same thread twice spends almost
   * nothing, while a thread that is nothing but links still unfurls.
   */
  linkPreview: { max: 120, windowSec: 3600 },
} as const;

export type RateLimitBucket = keyof typeof rateLimits;

/** Smoothing constant m in the weighted Bakchod Score. */
export const SCORE_SMOOTHING = 10;
/** Prior mean used before any ratings exist at all. */
export const SCORE_PRIOR_MEAN = 5.5;

/**
 * The For You mix: how many posts come from people you follow before one from
 * someone you do not.
 *
 * 3:1 rather than 1:1 deliberately. A feed that is half strangers stops being
 * *your* feed and starts being a discovery page, and people abandon it; a feed
 * that is all friends never grows the graph. Three to one is enough of a drip
 * that a new face turns up every screen without displacing the people you
 * actually came for.
 *
 * Read by `fetchForYou` in lib/posts.ts and asserted in test/feed-blend.test.ts.
 */
export const feedBlend = { followed: 3, discovery: 1 } as const;

