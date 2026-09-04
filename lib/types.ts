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
  /**
   * A moderator deleted it. Only ever true on a post being shown to its own
   * author — everyone else's queries exclude it — and when it is true the card
   * is a tombstone: no media, no rating, no thread.
   */
  modDeleted: boolean;
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
  /**
   * Which of their own posts they have pinned to their profile, if any.
   *
   * On the viewer rather than on the post because it is a fact about them, and
   * because a card holds its own copy of the post: a prop is the only channel that
   * still reaches every card after a pin moves, so the card that lost the pin
   * relabels itself along with the one that gained it.
   */
  pinnedPostId: string | null;
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
  | "ADMIN_DELETE"
  | "USER_JOINED"
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
 * The line quoted above a reply.
 *
 * Just enough of the original to recognise it, resolved on the server so the
 * client never has to have the quoted message still in memory — a reply to
 * something forty messages back is the normal case, and that message may be
 * pages above the window.
 *
 * `senderId` rather than a name: whose message it was is answered by comparing
 * against the viewer, and this ref travels on the realtime stream to *both* ends
 * of the thread, where a baked-in "You" would be wrong for one of them.
 */
export interface ClientReplyRef {
  id: string;
  senderId: string;
  /** One line of the quoted body. Null for an image-only or deleted original. */
  excerpt: string | null;
  hasImage: boolean;
  /** The quoted message has since been unsent. Quote it as gone, not as text. */
  deleted: boolean;
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
  /** When the sender last rewrote it, or null if these are the original words. */
  editedAt: string | null;
  deleted: boolean;
  /** Whether the signed-in viewer wrote it — the side of the thread it sits on. */
  mine: boolean;
  senderId: string;
  /** What it answers, or null for a message that starts its own point. */
  replyTo: ClientReplyRef | null;
}

/**
 * What a pasted link turns out to be.
 *
 * Fetched separately from the message rather than stored on it, because a message
 * is what somebody typed and this is what a website happened to say at the time —
 * one is history and the other is a lookup that can fail, expire or change.
 *
 * `icon` is a `data:` URL, not the remote one. The server has already been to that
 * host; sending the reader there too would let the site count everyone in the
 * thread who scrolled past the link.
 */
export interface ClientLinkPreview {
  /** The address that was actually fetched, redirects followed. */
  url: string;
  /** Lowercased, `www.` dropped. Drawn in caps by the card. */
  host: string;
  title: string | null;
  description: string | null;
  icon: string | null;
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
  /**
   * Whether their browser was actually listening when the invitation went out.
   *
   * This is what separates "Calling…" from "Ringing…" on the caller's screen. It is
   * not a guess from `lastSeenAt` — the bus knows whether a stream is open, and a
   * ring published to nobody makes no sound at all, which the caller deserves to be
   * told rather than left watching a timer.
   *
   * Absent on `signal` frames, which claim nothing about the peer beyond their id.
   */
  online?: boolean;
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
        replyTo: ClientReplyRef | null;
        author: { id: string; handle: string; displayName: string };
      };
    }
  | {
      /**
       * One message changed after the fact — rewritten, or unsent.
       *
       * Deliberately not a whole `ClientMessage`: `mine` is answered from whoever
       * is reading and this payload goes to both ends unchanged. The thread patches
       * the entry it already has, which is the only place the message exists.
       *
       * `body` is null on an unsend, and so is the image — the strip happens here
       * rather than in the client, for the same reason it happens in
       * `toClientMessage`. A tombstone that arrives carrying the original text has
       * not deleted anything.
       */
      type: "message-update";
      conversationId: string;
      messageId: string;
      body: string | null;
      editedAt: string | null;
      deleted: boolean;
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
  "message-update",
  "read",
  "typing",
  "unread",
  "call",
  "ping",
] as const;


