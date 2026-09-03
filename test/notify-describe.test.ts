import { describe, expect, it } from "vitest";
import {
  COLLAPSE_ON,
  MENTION_LIMIT,
  describeNotification,
  extractMentions,
  type DescribableNotification,
} from "@/lib/notifications";

/**
 * The two pure halves of the notification module.
 *
 * `describeNotification` is what a person actually reads, and every type has to
 * produce a sentence and either a real destination or an honest null — a type that
 * fell through the switch would return `undefined` and render as a blank row, which
 * looks like a rendering bug rather than a missing case.
 *
 * `extractMentions` decides whether an `@` in a caption pings a stranger. The
 * email-address case is the one worth having a test for.
 */

const NOTIFICATION_TYPES = [
  "FOLLOW",
  "RATING",
  "COMMENT",
  "MENTION",
  "STORY_VIEW",
  "MESSAGE",
  "CALL_MISSED",
  "ADMIN_HIDE",
  "ADMIN_DELETE",
  "USER_JOINED",
  "AI_COMMENT",
] as const;

const row = (over: Partial<DescribableNotification>): DescribableNotification => ({
  type: "FOLLOW",
  postId: "post1",
  conversationId: "conv1",
  actor: { displayName: "Priya", handle: "priya" },
  ...over,
});

describe("describeNotification", () => {
  it("has a sentence for every type", () => {
    for (const type of NOTIFICATION_TYPES) {
      const out = describeNotification(row({ type }), "me");
      expect(out.text, type).toBeTruthy();
      expect(out.text, type).not.toContain("undefined");
      expect(out.text, type).not.toContain("null");
    }
  });

  it("never produces a link to a missing thing", () => {
    // Every href has to survive the row it points at being gone. A `/p/null` is
    // worse than no link: it renders as a real anchor and 404s. Null is the right
    // answer here — the dropdown draws those rows as plain text.
    for (const type of NOTIFICATION_TYPES) {
      const { href } = describeNotification(
        row({ type, postId: null, conversationId: null, actor: null }),
        "me",
      );
      if (href === null) continue;
      expect(href, type).not.toContain("null");
      expect(href, type).not.toContain("undefined");
    }
  });

  it("falls back to a person-shaped word when the actor is gone", () => {
    // `actorId` is `onDelete: SetNull`, so a deleted account leaves live rows
    // behind with no actor at all.
    const out = describeNotification(row({ type: "RATING", actor: null }), "me");
    expect(out.text).toBe("Someone rated your bakchodi");
    expect(out.href).toBe("/p/post1");
  });

  it("sends a story view to the reader's own profile, not the watcher's", () => {
    const out = describeNotification(row({ type: "STORY_VIEW" }), "me");
    expect(out.href).toBe("/u/me");
  });

  it("names no moderator on a hidden post", () => {
    const out = describeNotification(row({ type: "ADMIN_HIDE" }), "me");
    expect(out.text).not.toContain("Priya");
    expect(out.href).toBeNull();
  });

  it("names no moderator on a deleted post, and links nowhere", () => {
    // The post is gone from every page including its own permalink; the only place
    // it still exists is the tombstone on the author's profile, which is not a
    // `/p/<id>`. A link here would 404.
    const out = describeNotification(row({ type: "ADMIN_DELETE" }), "me");
    expect(out.text).not.toContain("Priya");
    expect(out.href).toBeNull();
  });

  it("sends a join announcement to the person who joined", () => {
    const out = describeNotification(row({ type: "USER_JOINED" }), "me");
    expect(out.text).toBe("Priya joined Rate the Bakchod");
    expect(out.href).toBe("/u/priya");
  });

  it("points a follow at the follower and a message at the thread", () => {
    expect(describeNotification(row({ type: "FOLLOW" }), "me").href).toBe("/u/priya");
    expect(describeNotification(row({ type: "MESSAGE" }), "me").href).toBe(
      "/messages/conv1",
    );
  });

  it("escapes a handle before putting it in a URL", () => {
    // Handles are `[a-z0-9_]` by schema, so this can only come from a legacy or
    // hand-edited row — but the encode is what stops one becoming a path traversal.
    const out = describeNotification(
      row({ type: "FOLLOW", actor: { displayName: "X", handle: "../admin" } }),
      "me",
    );
    expect(out.href).toBe("/u/..%2Fadmin");
  });
});

describe("COLLAPSE_ON", () => {
  it("collapses the burst types and nothing else", () => {
    expect(COLLAPSE_ON.RATING).toBe("postId");
    expect(COLLAPSE_ON.STORY_VIEW).toBe("postId");
    expect(COLLAPSE_ON.MESSAGE).toBe("conversationId");
    // Two people commenting are two things to read.
    expect(COLLAPSE_ON.COMMENT).toBeUndefined();
    expect(COLLAPSE_ON.FOLLOW).toBeUndefined();
    expect(COLLAPSE_ON.MENTION).toBeUndefined();
  });
});

describe("extractMentions", () => {
  it("finds handles and lowercases them", () => {
    expect(extractMentions("oi @Rahul and @priya_1, look")).toEqual(["rahul", "priya_1"]);
  });

  it("ignores the local part of an email address", () => {
    expect(extractMentions("mail me at someone@example.com")).toEqual([]);
  });

  it("stops at characters a handle cannot contain", () => {
    expect(extractMentions("@rahul's post")).toEqual(["rahul"]);
    expect(extractMentions("@rahul-kumar")).toEqual(["rahul"]);
    expect(extractMentions("(@rahul)")).toEqual(["rahul"]);
  });

  it("ignores a bare @ and a too-short handle", () => {
    expect(extractMentions("@ @a what")).toEqual([]);
  });

  it("mentions each person once however many times they are named", () => {
    expect(extractMentions("@rahul @rahul @RAHUL")).toEqual(["rahul"]);
  });

  it("caps a caption that tries to notify the whole site", () => {
    const many = Array.from({ length: 40 }, (_, i) => `@person${i}`).join(" ");
    expect(extractMentions(many)).toHaveLength(MENTION_LIMIT);
  });

  it("treats no text as no mentions", () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions("")).toEqual([]);
  });
});
