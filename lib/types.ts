/**
 * Shapes that cross the server/client boundary.
 *
 * Deliberately plain: no `Date`, no `Decimal`, nothing Prisma-flavoured. The
 * feed is rendered once on the server and then extended by `fetch` calls, and
 * both paths have to produce identical props or hydration breaks. Dates are ISO
 * strings for exactly that reason.
 */

export type PostKindName = "IMAGE" | "VIDEO" | "AUDIO" | "TWEET";
export type ArchiveStateName = "PENDING" | "UPLOADING" | "UPLOADED" | "VERIFIED" | "FAILED";

export interface ClientAuthor {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isAI: boolean;
  bakchodScore: number;
}

export interface ClientPost {
  id: string;
  kind: PostKindName;
  caption: string | null;
  tweetText: string | null;
  /** Media URL, or null for a text-only tweet post. */
  mediaUrl: string | null;
  /** Video poster frame URL, when there is one. */
  posterUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  archiveState: ArchiveStateName;
  ratingsSum: number;
  ratingsCount: number;
  average: number | null;
  commentsCount: number;
  createdAt: string;
  author: ClientAuthor;
  /** What the signed-in viewer already rated this, if anything. */
  viewerRating: number | null;
}

export interface ClientComment {
  id: string;
  body: string;
  isAI: boolean;
  createdAt: string;
  author: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    isAI: boolean;
  };
}

export interface ClientViewer {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export type VisibilityName = "PUBLIC" | "SIGNED_IN";

export interface ClientProfileLink {
  label: string;
  url: string;
}

/**
 * The render-facing slice of someone's theme. Deliberately narrow: the privacy
 * *enums* are not here, because a visitor's browser has no use for them and
 * enforcement happens on the server anyway. The settings page fetches
 * `OwnerThemeSettings` instead, which is the full picture.
 */
export interface ClientProfileTheme {
  tagline: string | null;
  bio: string | null;
  /** Flat hex, or null for the app default. Applied only inside the header. */
  accent: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  links: ClientProfileLink[];
  /** Null when there is no intro to play, so the frame is never mounted. */
  welcome: { url: string; autoDismissMs: number } | null;
  allowComments: boolean;
}

/** Everything the owner may edit. Only ever sent to the owner. */
export interface OwnerThemeSettings {
  tagline: string | null;
  bio: string | null;
  accent: string | null;
  welcomeHtml: string | null;
  welcomeEnabled: boolean;
  welcomeMs: number;
  welcomePreset: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  links: ClientProfileLink[];
  pinnedPostId: string | null;
  visibility: VisibilityName;
  storiesVisibility: VisibilityName;
  showRatingsGiven: boolean;
  showJoinDate: boolean;
  allowComments: boolean;
  /** Who may open a DM. Enforced in `openConversation`, never in the UI. */
  dmPolicy: DmPolicyName;
}

/**
 * A profile page's subject. Richer than `ClientAuthor` — it carries the counts
 * that only the profile view asks for, so the feed does not pay for them.
 */
export interface ClientProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isAI: boolean;
  isAdmin: boolean;
  bakchodScore: number;
  /** Ratings received on this person's posts. */
  ratingsCount: number;
  /** Mean of those ratings, or null if nobody has rated them. */
  average: number | null;
  /** Visible posts only — hidden ones are moderated away and should not count. */
  postsCount: number;
  commentsCount: number;
  /**
   * Ratings this person has handed out to others. `null` when they have turned
   * the stat off — the field is genuinely absent rather than CSS-hidden, so
   * "don't show this" cannot be undone with dev tools.
   */
  ratingsGiven: number | null;
  /** Null when the join date is switched off. */
  joinedAt: string | null;
  /** Absent when the profile is stock — the AI account, and anyone new. */
  theme: ClientProfileTheme | null;
}

export interface ClientFeedPage {
  posts: ClientPost[];
  nextCursor: string | null;
}

export interface LeaderboardRow {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bakchodScore: number;
  ratingsCount: number;
}

// ---------------------------------------------------------------------------
// The follow graph
// ---------------------------------------------------------------------------

/**
 * A person as they appear in a list — followers, following, suggestions.
 *
 * `bakchodScore` is carried for everyone including the AI, where it is
 * structurally 0 because nothing can rate it. Nothing may render that number for
 * an AI row: `isAI` is the branch, and the card shows "House account" instead.
 */
export interface ClientPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isAI: boolean;
  bakchodScore: number;
  tagline: string | null;
  followersCount: number;
  /** Whether the viewer follows them. Null when signed out — no button to draw. */
  isFollowing: boolean | null;
  /** Why this person is being suggested, already phrased. Null when it is a plain list. */
  reason: string | null;
}

export interface ClientPeoplePage {
  people: ClientPerson[];
  nextCursor: string | null;
}

/** The follow state of one profile, as its header and button render it. */
export interface ClientFollowState {
  followersCount: number;
  followingCount: number;
  /** Null when signed out or looking at yourself — both mean "no button". */
  isFollowing: boolean | null;
}


// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export interface ClientStory {
  id: string;
  kind: PostKindName;
  caption: string | null;
  mediaUrl: string | null;
  posterUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  /** Null once it has been promoted into a highlight — highlights are forever. */
  expiresAt: string | null;
  /** Whether the current viewer has already opened it. False when signed out. */
  seen: boolean;
  /** Only ever populated for the story's own author. */
  viewsCount: number | null;
}

/** One person's run of active stories, as the tray renders it. */
export interface ClientStoryTray {
  author: ClientAuthor;
  stories: ClientStory[];
  hasUnseen: boolean;
}

export interface ClientHighlight {
  id: string;
  title: string;
  coverUrl: string | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationKind =
  | "FOLLOW"
  | "RATING"
  | "COMMENT"
  | "MENTION"
  | "STORY_VIEW"
  | "MESSAGE"
  | "CALL_MISSED"
  | "ADMIN_HIDE"
  | "AI_COMMENT";

/**
 * One row in the bell.
 *
 * `text` and `href` are composed on the server rather than assembled in the
 * dropdown. The wording of a notification depends on the type, the actor and
 * sometimes on who is reading it, and that decision belongs in one place — a
 * client that builds its own sentences drifts from the ones the realtime push
 * already sent.
 */
export interface ClientNotification {
  id: string;
  kind: NotificationKind;
  text: string;
  /** Where clicking goes. Null when the thing it referred to is gone. */
  href: string | null;
  actor: { handle: string; displayName: string; avatarUrl: string | null } | null;
  read: boolean;
  createdAt: string;
}

export interface ClientNotificationPage {
  notifications: ClientNotification[];
  nextCursor: string | null;
  /** Unread total, so the badge and the list arrive together. */
  unread: number;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export type DmPolicyName = "EVERYONE" | "FOLLOWERS" | "NOBODY";

/** The other person in a thread. Two-person threads only, so there is just one. */
export interface ClientCounterpart {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isAI: boolean;
  /** Rough presence, from `lastSeenAt`. Null when they have never been seen. */
  lastSeenAt: string | null;
}

/**
 * One message.
 *
 * A deleted message keeps its row and its place in the thread — `deleted` is
 * true and `body`/`imageUrl` are stripped on the server, so the tombstone the
 * other side sees carries none of the original content.
 */
export interface ClientMessage {
  id: string;
  /** Null for an image-only message, or for a deleted one. */
  body: string | null;
  imageUrl: string | null;
  createdAt: string;
  deleted: boolean;
  /** Whether the signed-in viewer wrote it — the side of the thread it sits on. */
  mine: boolean;
  senderId: string;
}

/**
 * A call as it appears in the timeline, between the messages.
 *
 * Calls and messages are separate tables, so the thread interleaves them by
 * timestamp. `direction` is resolved server-side because "Outgoing" depends on
 * who is reading.
 */
export interface ClientCallEntry {
  id: string;
  kind: CallKindName;
  status: "RINGING" | "ACCEPTED" | "DECLINED" | "MISSED" | "ENDED" | "FAILED";
  direction: "in" | "out";
  /** Null unless the call was actually answered and then ended. */
  durationMs: number | null;
  createdAt: string;
}

export type ClientThreadEntry =
  | ({ entry: "message" } & ClientMessage)
  | ({ entry: "call" } & ClientCallEntry);

/** One row in the conversation list. */
export interface ClientConversation {
  id: string;
  counterpart: ClientCounterpart;
  /** Already-flattened preview text: the last message's body, or "Photo". */
  preview: string;
  lastMessageAt: string;
  unread: boolean;
}

export interface ClientConversationList {
  conversations: ClientConversation[];
  /** How many rows have something unread, for the rail's dot. */
  unreadConversations: number;
}

/** One open thread, oldest entry first — the order it is read in. */
export interface ClientThread {
  id: string;
  counterpart: ClientCounterpart;
  entries: ClientThreadEntry[];
  /** Cursor for older entries, or null at the start of the thread. */
  prevCursor: string | null;
  /** When the other side last read it, for the delivered/read tick. */
  theirLastReadAt: string | null;
  /** Whether this viewer may still send — a policy can close mid-thread. */
  canSend: boolean;
}

// ---------------------------------------------------------------------------
// The realtime stream
// ---------------------------------------------------------------------------

export type CallKindName = "VOICE" | "VIDEO";

/**
 * The other person on a call.
 *
 * Shared between the signalling event and the panel that draws it, so the ringing
 * screen renders from exactly the fields the invitation carried and never has to fetch
 * a profile mid-ring.
 */
export interface ClientCallPeer {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * A call's lifecycle, as it travels over the wire.
 *
 * `signal` is the odd one out: it carries SDP and ICE and is relayed between the
 * two ends without ever being stored, because those payloads contain the
 * participants' network addresses.
 */
export type CallPhase = "invite" | "accept" | "decline" | "end" | "signal";

/**
 * Everything the server can push down the SSE stream. Discriminated on `type`.
 *
 * This lives here, in the Prisma-free module, rather than beside the bus in
 * `lib/realtime.ts` — that file is `server-only`, and the provider that reads
 * these events is a client component. The bus re-exports the type so server
 * callers still find it where they expect.
 */
export type RealtimeEvent =
  | {
      type: "notification";
      /** The bell's unread total after this one, so the badge never has to ask. */
      unread: number;
      notification: {
        id: string;
        kind: NotificationKind;
        text: string;
        href: string | null;
        actor: { handle: string; displayName: string; avatarUrl: string | null } | null;
        createdAt: string;
      };
    }
  | {
      type: "message";
      conversationId: string;
      /** Total unread conversations, for the rail's dot. */
      unreadConversations: number;
      message: {
        id: string;
        body: string | null;
        imageUrl: string | null;
        createdAt: string;
        author: { id: string; handle: string; displayName: string };
      };
    }
  | { type: "read"; conversationId: string; by: string; at: string }
  | { type: "typing"; conversationId: string; by: string }
  | {
      /**
       * A pure badge correction, addressed to the person whose badges changed.
       *
       * Reading a thread in one tab has to clear the dot in the others, and it also
       * clears the bell row the message left behind — two counters that no other
       * event carries, because every other event is *about* something that happened
       * to somebody else.
       */
      type: "unread";
      notifications: number;
      conversations: number;
    }
  | {
      type: "call";
      callId: string;
      conversationId: string;
      kind: CallKindName;
      phase: CallPhase;
      from: ClientCallPeer;
      signal?: unknown;
      /**
       * The finished row for the timeline, on `decline` and `end` only.
       *
       * Sent per recipient rather than shared, because `direction` is answered from
       * whoever is reading — the same call is "out" on one side and "in" on the other.
       */
      entry?: ClientCallEntry;
    };

/** Every `event:` name a frame can carry, including the keep-alive. */
export const REALTIME_EVENT_NAMES = [
  "notification",
  "message",
  "read",
  "typing",
  "unread",
  "call",
  "ping",
] as const;


