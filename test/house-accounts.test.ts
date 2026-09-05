import { describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { AI_HANDLE, OFFICIAL_HANDLE, OFFICIAL_NAME, __houseInternals } from "@/lib/house-accounts";
import { DisplayNameSchema, RESERVED_HANDLES } from "@/lib/profile-schema";

/**
 * The two accounts nobody can log in as, and the four things about them that break
 * quietly.
 *
 * A house profile is written by code, not typed into a form, so nothing validates it
 * on the way in: an avatar that needs a font, a splash that busts the column cap or
 * lays itself out sideways, and a handle a stranger can claim all look completely
 * fine in a diff and only show up on a deployed page.
 */

const {
  SPARK_MARK,
  CHECK_MARK,
  AI_BANNER,
  OFFICIAL_BANNER,
  ADMIN_BANNER,
  AI_WELCOME,
  OFFICIAL_WELCOME,
  toPng,
} = __houseInternals;

/**
 * Every drawn asset, marks and banners together.
 *
 * One map rather than two, because each rule below — no font, nothing fetched, flat,
 * three colours, rasterises — is a property of *house art*, not of avatars. Splitting
 * them is how a banner ends up being the one thing nobody checked.
 */
const ART = {
  spark: SPARK_MARK,
  check: CHECK_MARK,
  aiBanner: AI_BANNER,
  officialBanner: OFFICIAL_BANNER,
  adminBanner: ADMIN_BANNER,
};

const SVG = Object.fromEntries(
  Object.entries(ART).map(([name, buf]) => [name, buf.toString("utf8")]),
);

const SPLASHES = { ai: AI_WELCOME, official: OFFICIAL_WELCOME };

describe("house art", () => {
  /**
   * librsvg draws nothing at all when fontconfig has no font — the same failure
   * `canRenderText` exists to detect for the bot's cards. A mark made of paths has
   * no font to miss, and that is the only reason it is safe to render one at boot
   * on a container we do not control.
   */
  it("needs no font", () => {
    for (const [name, svg] of Object.entries(SVG)) {
      expect(svg, name).not.toMatch(/<text|font-family|font-size/i);
    }
  });

  it("fetches nothing", () => {
    // A house avatar that referenced anything external would resolve it inside
    // librsvg, on the server, at boot.
    for (const [name, svg] of Object.entries(SVG)) {
      expect(svg, name).not.toMatch(/xlink:href|<image|<use|url\(/i);
      expect(svg, name).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    }
  });

  it("stays flat — no gradient outside the chat surface", () => {
    for (const [name, svg] of Object.entries(SVG)) {
      expect(svg, name).not.toMatch(/Gradient/i);
    }
  });

  it("is monochrome on panel, so no palette can fight it", () => {
    // White ink, panel ground, the one line colour. Same rule as the rest of the
    // app: the accent is white, so `ProfileTheme.accent` is left null.
    const allowed = new Set(["#0f1011", "#2e3034", "#f4f4f5"]);
    for (const [name, svg] of Object.entries(SVG)) {
      for (const hex of svg.match(/#[0-9a-f]{3,8}/gi) ?? []) {
        expect(allowed.has(hex.toLowerCase()), `${name} uses ${hex}`).toBe(true);
      }
    }
  });

  it("rasterises to a PNG", async () => {
    for (const [name, svg] of Object.entries(ART)) {
      const png = await toPng(svg);
      // Magic bytes rather than a length check: `putProfileAsset` sniffs its input
      // and refuses anything that is not a raster, so this is the contract.
      expect(png.subarray(0, 8).toString("hex"), name).toBe("89504e470d0a1a0a");
      expect(png.byteLength, name).toBeGreaterThan(400);
    }
  });

  it("draws five different pictures", () => {
    // At 32px in a feed, the platform and the bot must not read as the same grey
    // scribble — one is an outlined spark, the other a filled disc. Same for the
    // three banners: an account whose header is another account's is not branding.
    const drawn = Object.values(SVG);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("draws a mark square and a banner wide", () => {
    // A mark lands in a 256px slot and is clipped to a circle by CSS, so it is
    // square. A banner is drawn 4:1 for a header that crops it vertically from
    // about 3:1 to 6:1 — a square one would be cropped to a sliver of its middle.
    for (const name of ["spark", "check"] as const) {
      expect(SVG[name], name).toContain(`width="512" height="512"`);
    }
    for (const name of ["aiBanner", "officialBanner", "adminBanner"] as const) {
      expect(SVG[name], name).toContain(`width="1600" height="400"`);
    }
  });
});

describe("house splashes", () => {
  it("fits the cap the editor enforces", () => {
    // Written by code, so nothing checks it on the way in — but an admin who opens
    // the profile editor and presses Save would be told the HTML is too long.
    for (const [name, html] of Object.entries(SPLASHES)) {
      expect(Buffer.byteLength(html, "utf8"), name).toBeLessThanOrEqual(
        limits.welcomeHtmlMaxBytes,
      );
    }
  });

  it("dismisses itself", () => {
    // The sandbox document owns no timer — see `lib/welcome-doc.ts`. A splash that
    // never calls `rtbDone()` sits on the profile until the visitor gives up.
    for (const [name, html] of Object.entries(SPLASHES)) {
      expect(html, name).toContain("rtbDone");
    }
  });

  it("has exactly one wrapper element", () => {
    // `buildWelcomeDoc` centres the body with flex, so two top-level children come
    // out side by side instead of stacked.
    for (const [name, html] of Object.entries(SPLASHES)) {
      expect(html.match(/^<div class="rtb">/m), name).toBeTruthy();
      expect(html.match(/<div /g)?.length, name).toBe(1);
    }
  });

  it("stays flat and uses the theme accent", () => {
    for (const [name, html] of Object.entries(SPLASHES)) {
      expect(html, name).not.toMatch(/gradient/i);
      expect(html, name).toContain("var(--accent)");
    }
  });

  it("names the platform on the platform's own splash", () => {
    expect(OFFICIAL_WELCOME).toContain(OFFICIAL_NAME);
  });
});

describe("house identity", () => {
  it("reserves both handles, so nobody can claim one", () => {
    // The accounts are created directly rather than through `HandleSchema`, so
    // reserving them costs nothing and is the only thing standing between a
    // stranger and the handle every platform notice arrives from.
    expect(RESERVED_HANDLES.has(AI_HANDLE)).toBe(true);
    expect(RESERVED_HANDLES.has(OFFICIAL_HANDLE)).toBe(true);
  });

  it("refuses the platform's name as a display name", () => {
    for (const name of ["Rate the Bakchod", "rate  the   bakchod", "RateTheBakchod", "Bakchod AI"]) {
      expect(DisplayNameSchema.safeParse(name).success, name).toBe(false);
    }
  });

  it("still accepts an ordinary name", () => {
    expect(DisplayNameSchema.safeParse("Priyanshu").success).toBe(true);
    expect(DisplayNameSchema.safeParse("Bakchod Number 1").success).toBe(true);
  });
});
