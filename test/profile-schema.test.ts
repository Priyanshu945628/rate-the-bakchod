import { describe, expect, it } from "vitest";
import {
  HEX_RE,
  HighlightTitleSchema,
  ProfileLinksSchema,
  ThemePatchSchema,
  WelcomePreviewSchema,
  isSafeLinkUrl,
  utf8Bytes,
} from "@/lib/profile-schema";
import { limits } from "@/lib/config";

describe("HEX_RE", () => {
  it("accepts flat six-digit hex in either case", () => {
    expect(HEX_RE.test("#2f81f7")).toBe(true);
    expect(HEX_RE.test("#2F81F7")).toBe(true);
  });

  it("rejects shorthand, named colours and anything with room for a payload", () => {
    expect(HEX_RE.test("#fff")).toBe(false);
    expect(HEX_RE.test("red")).toBe(false);
    expect(HEX_RE.test("#2f81f7;")).toBe(false);
    // The reason the regex is anchored: no gradients is a hard rule, and this is
    // the shape an API bug would need to smuggle one into a style attribute.
    expect(HEX_RE.test("red; background-image: linear-gradient(red, blue)")).toBe(false);
  });
});

describe("isSafeLinkUrl", () => {
  it("accepts plain http and https", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("http://example.com/path?q=1#frag")).toBe(true);
  });

  it("rejects every scheme that is not on the allowlist", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeLinkUrl("vbscript:msgbox")).toBe(false);
    expect(isSafeLinkUrl("blob:https://example.com/abc")).toBe(false);
    expect(isSafeLinkUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects relative and malformed URLs", () => {
    expect(isSafeLinkUrl("/settings")).toBe(false);
    expect(isSafeLinkUrl("example.com")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
  });

  it("rejects userinfo, which is how a link is dressed up as another site", () => {
    // Renders as "paypal.com" in a lot of UIs; actually goes to evil.example.
    expect(isSafeLinkUrl("https://paypal.com@evil.example")).toBe(false);
    expect(isSafeLinkUrl("https://user:pw@evil.example")).toBe(false);
  });
});

describe("ProfileLinksSchema", () => {
  const link = (n: number) => ({ label: `L${n}`, url: `https://example.com/${n}` });

  it("accepts up to the cap", () => {
    const links = Array.from({ length: limits.maxLinks }, (_, i) => link(i));
    expect(ProfileLinksSchema.safeParse(links).success).toBe(true);
  });

  it("rejects one over the cap", () => {
    const links = Array.from({ length: limits.maxLinks + 1 }, (_, i) => link(i));
    expect(ProfileLinksSchema.safeParse(links).success).toBe(false);
  });

  it("rejects a link with an unsafe scheme even when the label is fine", () => {
    const result = ProfileLinksSchema.safeParse([
      { label: "Click", url: "javascript:alert(1)" },
    ]);
    expect(result.success).toBe(false);
  });

  it("requires a label", () => {
    expect(
      ProfileLinksSchema.safeParse([{ label: "  ", url: "https://example.com" }]).success,
    ).toBe(false);
  });
});

describe("ThemePatchSchema", () => {
  it("treats blank strings as 'clear this', not as stored whitespace", () => {
    const result = ThemePatchSchema.safeParse({ tagline: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tagline).toBeNull();
  });

  it("refuses an empty patch, so a no-op cannot look like a save", () => {
    expect(ThemePatchSchema.safeParse({}).success).toBe(false);
  });

  it("keeps an absent key absent — that is what 'leave it alone' relies on", () => {
    const result = ThemePatchSchema.safeParse({ bio: "hi" });
    expect(result.success).toBe(true);
    if (result.success) expect("tagline" in result.data).toBe(false);
  });

  it("enforces the tagline and bio caps", () => {
    expect(
      ThemePatchSchema.safeParse({ tagline: "x".repeat(limits.taglineMaxLength) }).success,
    ).toBe(true);
    expect(
      ThemePatchSchema.safeParse({ tagline: "x".repeat(limits.taglineMaxLength + 1) })
        .success,
    ).toBe(false);
    expect(
      ThemePatchSchema.safeParse({ bio: "x".repeat(limits.bioMaxLength + 1) }).success,
    ).toBe(false);
  });

  it("enforces the welcome HTML byte cap, measured in bytes not characters", () => {
    // A multi-byte character must count for what it actually costs the column.
    const multibyte = "😀".repeat(limits.welcomeHtmlMaxBytes / 4);
    expect(utf8Bytes(multibyte)).toBe(limits.welcomeHtmlMaxBytes);
    expect(ThemePatchSchema.safeParse({ welcomeHtml: multibyte }).success).toBe(true);
    expect(
      ThemePatchSchema.safeParse({ welcomeHtml: multibyte + "😀" }).success,
    ).toBe(false);
  });

  it("does not accept an asset key — only the upload route may set those", () => {
    const result = ThemePatchSchema.safeParse({ bannerKey: "a".repeat(32) });
    // No recognised key means an empty patch, which the refine rejects.
    expect(result.success).toBe(false);
  });

  it("bounds the auto-dismiss delay", () => {
    expect(ThemePatchSchema.safeParse({ welcomeMs: 0 }).success).toBe(true);
    expect(ThemePatchSchema.safeParse({ welcomeMs: limits.welcomeMaxMs }).success).toBe(true);
    expect(ThemePatchSchema.safeParse({ welcomeMs: limits.welcomeMaxMs + 1 }).success).toBe(
      false,
    );
    expect(ThemePatchSchema.safeParse({ welcomeMs: -1 }).success).toBe(false);
  });

  it("only accepts the two visibility values", () => {
    expect(ThemePatchSchema.safeParse({ visibility: "PUBLIC" }).success).toBe(true);
    expect(ThemePatchSchema.safeParse({ visibility: "SIGNED_IN" }).success).toBe(true);
    expect(ThemePatchSchema.safeParse({ visibility: "PRIVATE" }).success).toBe(false);
  });

  it("rejects a malformed accent", () => {
    expect(ThemePatchSchema.safeParse({ accent: "#2f81f7" }).success).toBe(true);
    expect(ThemePatchSchema.safeParse({ accent: "rebeccapurple" }).success).toBe(false);
  });
});

describe("HighlightTitleSchema", () => {
  it("needs a title and caps its length", () => {
    expect(HighlightTitleSchema.safeParse("Roasts").success).toBe(true);
    expect(HighlightTitleSchema.safeParse("   ").success).toBe(false);
    expect(
      HighlightTitleSchema.safeParse("x".repeat(limits.highlightTitleMaxLength + 1)).success,
    ).toBe(false);
  });
});

describe("WelcomePreviewSchema", () => {
  it("accepts a draft and an optional validated accent", () => {
    expect(WelcomePreviewSchema.safeParse({ html: "<p>hi</p>" }).success).toBe(true);
    expect(
      WelcomePreviewSchema.safeParse({ html: "<p>hi</p>", accent: "#2f81f7" }).success,
    ).toBe(true);
  });

  it("rejects an accent that is not flat hex", () => {
    expect(
      WelcomePreviewSchema.safeParse({ html: "", accent: "red; x: linear-gradient(a,b)" })
        .success,
    ).toBe(false);
  });
});
