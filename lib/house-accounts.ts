import "server-only";

import sharp from "sharp";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "./prisma";
import { putProfileAsset } from "./profile";
import { findPreset, renderPreset } from "./welcome-presets";

/**
 * The two accounts nobody can log in as.
 *
 * `bakchod_ai` writes the comments and its own posts. `ratethebakchod` is the
 * platform speaking: every update, every moderation notice. Neither has a
 * `supabaseId`, which is the one fact separating a house account from a person and
 * the thing {@link announceJoin} filters on — a bell nobody can open is not a row
 * worth writing.
 *
 * They are ensured lazily rather than seeded in SQL, because a profile is not
 * schema. A picture, a tagline and a splash are content, and the panel may edit any
 * of them afterwards. So the copy here is a *starting point*: a row that already
 * exists gets its empty fields filled and nothing else touched. Reasserting the
 * house text on every tick would mean an admin's edit quietly reverting.
 */

export const AI_HANDLE = "bakchod_ai";
export const OFFICIAL_HANDLE = "ratethebakchod";
export const OFFICIAL_NAME = "Rate the Bakchod";

/**
 * The two glyphs, as bare path data in a 24×24 box.
 *
 * Written once because each is drawn three times at three sizes — an avatar, a
 * banner and a splash — and a spark whose tail had drifted in one of them would
 * look like a different account rather than like a bug.
 */
const SPARK_PATH = "M12 4.5 13.3 9l4.2 1.4-4.2 1.4L12 16.3l-1.3-4.5L6.5 10.4 10.7 9 12 4.5Z";
const SPARK_TAIL = "M18 16.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z";
const CHECK_PATH = "M8.2 12.3 10.8 14.9 15.9 9.2";

/** Ink, panel ground, and the one line colour — the whole house palette. */
const INK = "#f4f4f5";
const GROUND = "#0f1011";
const LINE = "#2e3034";

/**
 * A house picture, drawn rather than uploaded.
 *
 * Pure shapes, no `<text>`: librsvg draws nothing at all when fontconfig has no
 * font, which is exactly the failure {@link canRenderText} exists to detect for the
 * bot's cards. A mark made of paths has no font dependency and so cannot come out
 * blank on a container that ships without one.
 *
 * White on panel, because the accent is white — same rule as the rest of the app,
 * so `ProfileTheme.accent` stays null and a palette switch does not fight the
 * avatar. Full-bleed background: the avatar element clips to a circle in CSS.
 */
function houseMark(inner: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24">` +
      `<rect width="24" height="24" fill="${GROUND}"/>` +
      `<circle cx="12" cy="12" r="11.3" fill="none" stroke="${LINE}" stroke-width="0.6"/>` +
      inner +
      `</svg>`,
  );
}

/**
 * The bot's mark: the app's own spark, the same one `Avatar` falls back to.
 *
 * Scaled to about three quarters, because the icon is drawn 4→20 for a toolbar and
 * an avatar wants air around the glyph rather than a shape touching the rim.
 */
const SPARK_MARK = houseMark(
  `<g transform="translate(12 12) scale(0.74) translate(-12 -12)" fill="none" stroke="${INK}" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${SPARK_PATH}"/>` +
    `<path d="${SPARK_TAIL}"/>` +
    `</g>`,
);

/**
 * The platform's mark: a filled disc with the check knocked out of it.
 *
 * Inverted on purpose. At 32px in a feed the bot's outlined spark and a second
 * outlined glyph would read as the same grey scribble; a solid white disc is
 * legible at any size and is the one thing on the page that looks like the platform
 * rather than like a user.
 */
const CHECK_MARK = houseMark(
  `<circle cx="12" cy="12" r="8.6" fill="${INK}"/>` +
    `<path d="${CHECK_PATH}" fill="none" stroke="${GROUND}" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`,
);

/**
 * A house banner. 4:1, because the header renders it `h-32 sm:h-40` full-width under
 * `object-cover` — anything from 3:1 on a phone to about 6:1 on a wide desktop, so the
 * art has to survive a vertical crop. Everything below therefore sits in the middle
 * band and nothing load-bearing goes near the top or bottom edge.
 */
function houseBanner(inner: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400" viewBox="0 0 160 40">` +
      `<rect width="160" height="40" fill="${GROUND}"/>` +
      inner +
      `</svg>`,
  );
}

/** Nine slots across the width, the middle one at dead centre (x = 80 of 160). */
function acrossBanner(draw: (x: number, lead: boolean) => string): string {
  return Array.from({ length: 9 }, (_, i) => draw(8 + i * 18, i === 4)).join("");
}

/**
 * The bot's banner: its own mark, repeated quietly, one of them lit.
 *
 * The same glyph as the avatar rather than a second idea, so a visitor who arrived
 * from a comment recognises the thing they clicked. `stroke-width` lives inside the
 * scaled group, so it shrinks with the glyph — the quiet ones come out thinner as
 * well as smaller and darker, which is what keeps nine sparks from reading as noise.
 * The tail is drawn on the lit one only; at a third scale it would be mush.
 */
const AI_BANNER = houseBanner(
  acrossBanner(
    (x, lead) =>
      `<g transform="translate(${x} 20) scale(${lead ? 0.62 : 0.34}) translate(-12 -12)" ` +
      `fill="none" stroke="${lead ? INK : LINE}" stroke-width="${lead ? 1.5 : 1.9}" ` +
      `stroke-linecap="round" stroke-linejoin="round"><path d="${SPARK_PATH}"/>` +
      (lead ? `<path d="${SPARK_TAIL}"/>` : ``) +
      `</g>`,
  ),
);

/** The platform's banner: the same inversion its avatar uses, at the centre. */
const OFFICIAL_BANNER = houseBanner(
  acrossBanner((x, lead) =>
    lead
      ? `<circle cx="${x}" cy="20" r="7.4" fill="${INK}"/>` +
        `<g transform="translate(${x} 20) scale(0.62) translate(-12 -12)" fill="none" ` +
        `stroke="${GROUND}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="${CHECK_PATH}"/></g>`
      : `<circle cx="${x}" cy="20" r="3.1" fill="none" stroke="${LINE}" stroke-width="0.6"/>`,
  ),
);

/**
 * The admin's banner: texture, no glyph.
 *
 * A person does not wear a house mark — that is the one thing the two accounts above
 * own, and putting a spark or a check on a human profile is how somebody ends up
 * looking like the platform. So this is the chrome's own hairline rail in a rhythm:
 * it makes the profile look finished without claiming anything.
 *
 * Every fourth tick is tall, counted outward from the middle one rather than from the
 * left edge, so the long marks mirror around dead centre and one of them lands there —
 * the same anchor the other two banners put their lead element on. 22 units tall keeps
 * even those inside the ~25-unit band a 6:1 desktop crop leaves of a 4:1 source, so the
 * rail is never a row of lines with their ends sliced off.
 */
const ADMIN_BANNER = houseBanner(
  Array.from({ length: 31 }, (_, i) => {
    const h = (i - 15) % 4 === 0 ? 22 : 11;
    return (
      `<rect x="${5 + i * 5}" y="${20 - h / 2}" width="0.5" height="${h}" fill="${LINE}"/>`
    );
  }).join(""),
);

/**
 * SVG in, PNG out — `putProfileAsset` sniffs its input and only takes a raster.
 *
 * No `density`: every SVG above declares its size in pixels, and sharp's default 72
 * DPI renders exactly that. A mark is drawn at 512 for a 256 slot (one clean halving
 * before the webp pass) and a banner at its slot's full 1600, so raising the DPI
 * would only rasterise millions of pixels on the way to being resized back down.
 */
function toPng(svg: Buffer): Promise<Buffer> {
  return sharp(svg).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * The splash a house profile opens with.
 *
 * One wrapper element, because {@link buildWelcomeDoc} centres the body with flex —
 * two top-level children would come out side by side. Flat fills and `var(--accent)`
 * per the theme rule, and `rtbDone()` is called explicitly: the document owns its own
 * dismissal, nothing upstream times it out.
 */
const AI_WELCOME = `<style>
.rtb{display:grid;justify-items:center;gap:14px}
.rtb svg{width:64px;height:64px;color:var(--accent);animation:rtb-turn 2s cubic-bezier(.3,.9,.2,1) both}
.rtb p{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;animation:rtb-in .6s .5s both}
.rtb b{color:var(--accent)}
@keyframes rtb-turn{from{transform:rotate(-140deg) scale(.5);opacity:0}to{transform:none;opacity:1}}
@keyframes rtb-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
</style>
<div class="rtb">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${SPARK_PATH}"/><path d="${SPARK_TAIL}"/></svg>
<p>Aa gaye? <b>Baith jao.</b></p>
</div>
<script>setTimeout(rtbDone,2800)</script>`;

const OFFICIAL_WELCOME = `<style>
.rtb{display:grid;justify-items:center;gap:16px}
.rtb i{display:grid;place-items:center;width:60px;height:60px;border-radius:999px;background:var(--accent);animation:rtb-pop .55s cubic-bezier(.2,.9,.3,1) both}
.rtb svg{width:34px;height:34px;color:#0f1011}
.rtb strong{font-size:26px;font-weight:700;letter-spacing:-.02em;animation:rtb-in .6s .45s both}
.rtb span{font-size:14px;opacity:.62;animation:rtb-in .6s .65s both}
@keyframes rtb-pop{from{transform:scale(.55);opacity:0}to{transform:none;opacity:1}}
@keyframes rtb-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
</style>
<div class="rtb">
<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 12.4 10.4 16.4 17.7 8.6"/></svg></i>
<strong>${OFFICIAL_NAME}</strong>
<span>Har update yahin aata hai.</span>
</div>
<script>setTimeout(rtbDone,3000)</script>`;

type ThemeSeed = Omit<Prisma.ProfileThemeUncheckedCreateInput, "userId">;

interface HouseSpec {
  handle: string;
  displayName: string;
  /** Only the bot. The platform account is not an AI and must not wear the spark. */
  isAI: boolean;
  logo: Buffer;
  banner: Buffer;
  theme: ThemeSeed;
}

const AI_SPEC: HouseSpec = {
  handle: AI_HANDLE,
  displayName: "Bakchod AI",
  isAI: true,
  logo: SPARK_MARK,
  banner: AI_BANNER,
  theme: {
    tagline: "Resident bakchod. Roast karta hoon, rating nahi leta.",
    bio:
      "Main har post pe apni raay deta hoon, chahe kisi ne maangi ho ya na maangi ho.\n" +
      "Mujhe rate karne ka option nahi hai — house account hoon, scoreboard se bahar.",
    welcomeHtml: AI_WELCOME,
    /** A backstop only: the splash calls `rtbDone()` itself at 2.8s. */
    welcomeMs: 4000,
    /** It hands out no ratings, so the stat would be a zero with nothing behind it. */
    showRatingsGiven: false,
    /** Nobody can log in as it, so a DM here would be a message into a drawer. */
    dmPolicy: "NOBODY",
  },
};

const OFFICIAL_SPEC: HouseSpec = {
  handle: OFFICIAL_HANDLE,
  displayName: OFFICIAL_NAME,
  isAI: false,
  logo: CHECK_MARK,
  banner: OFFICIAL_BANNER,
  theme: {
    tagline: "Official account. Updates aur notices yahin se.",
    bio:
      "Naye features, downtime, rule changes — sab yahin post hote hain.\n" +
      "Yeh account kisi ko rate nahi karta aur khud rate nahi hota.",
    welcomeHtml: OFFICIAL_WELCOME,
    welcomeMs: 4000,
    showRatingsGiven: false,
    dmPolicy: "NOBODY",
  },
};

/** What an existing row is checked against. Empty means "never filled in". */
interface ExistingText {
  tagline: string | null;
  bio: string | null;
  welcomeHtml: string | null;
}

/**
 * The patch for a row that already exists: empty fields only.
 *
 * The rule that matters is what is *missing* here. Nothing overwrites a value, so an
 * admin who rewrites the bot's bio keeps it — this runs on every tick, and a house
 * default reasserting itself over a deliberate edit is a bug that looks like magic.
 */
function fillEmpty(existing: ExistingText, seed: ThemeSeed): Prisma.ProfileThemeUpdateInput {
  const patch: Prisma.ProfileThemeUpdateInput = {};
  if (!existing.tagline && seed.tagline) patch.tagline = seed.tagline;
  if (!existing.bio && seed.bio) patch.bio = seed.bio;
  if (!existing.welcomeHtml && seed.welcomeHtml) {
    patch.welcomeHtml = seed.welcomeHtml;
    patch.welcomePreset = seed.welcomePreset ?? null;
    // Filling the splash also turns it on. A stored animation that never plays is
    // not a half-configured profile, it is a broken one.
    patch.welcomeEnabled = true;
  }
  return patch;
}

/**
 * Draw a picture into a slot, or leave the account without one.
 *
 * Swallowed on purpose: this runs inside the bot's tick and on an admin page render,
 * and a container whose sharp cannot rasterise SVG is a missing banner, not a reason
 * for the feed to stop.
 */
async function mintAsset(
  user: User,
  slot: "LOGO" | "BANNER",
  svg: Buffer,
): Promise<void> {
  try {
    await putProfileAsset(user, slot, await toPng(svg));
  } catch (error) {
    console.warn(
      `[house] no ${slot.toLowerCase()} for @${user.handle}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Which pictures a theme row already had. Null means the slot is free to fill. */
interface SeededKeys {
  logoKey: string | null;
  bannerKey: string | null;
}

/**
 * Write the seed into a theme row, and report what pictures that row already had.
 *
 * Read first, then write only if there is something to write: this runs on every tick
 * and on every admin page load, and an UPDATE that sets nothing is still a row lock.
 */
async function seedTheme(userId: string, seed: ThemeSeed): Promise<SeededKeys> {
  const existing = await prisma.profileTheme.findUnique({
    where: { userId },
    select: {
      logoKey: true,
      bannerKey: true,
      tagline: true,
      bio: true,
      welcomeHtml: true,
    },
  });

  if (!existing) {
    // `upsert`, not `create`: another tick may have made the row since that read.
    await prisma.profileTheme.upsert({
      where: { userId },
      create: { userId, ...seed },
      update: {},
    });
    return { logoKey: null, bannerKey: null };
  }

  const patch = fillEmpty(existing, seed);
  if (Object.keys(patch).length > 0) {
    await prisma.profileTheme.update({ where: { userId }, data: patch });
  }
  return { logoKey: existing.logoKey, bannerKey: existing.bannerKey };
}

/**
 * Create the account if it is missing, fill in whatever is blank, and draw each
 * picture once.
 *
 * Ordering is load-bearing twice over. The theme row is written before either mark,
 * because {@link putProfileAsset} upserts that row itself to move the pointer — mint
 * first and the seed would land on a row that already exists and be treated as an
 * edit worth preserving. And the two mints are sequential rather than a `Promise.all`
 * for the same reason: each opens a transaction that upserts this one row.
 */
async function ensureHouseAccount(spec: HouseSpec): Promise<User> {
  const found = await prisma.user.findUnique({ where: { handle: spec.handle } });
  const user =
    found ??
    (await prisma.user.upsert({
      where: { handle: spec.handle },
      // No `supabaseId`, ever: that absence is what makes this a house account
      // rather than a person, and it is what every "is this a real user" filter
      // reads — the join fan-out, the mention pings.
      create: { handle: spec.handle, displayName: spec.displayName, isAI: spec.isAI },
      update: {},
    }));

  const keys = await seedTheme(user.id, spec.theme);
  if (!keys.logoKey) await mintAsset(user, "LOGO", spec.logo);
  if (!keys.bannerKey) await mintAsset(user, "BANNER", spec.banner);
  return user;
}

/** The bot. Called on every tick, so it is cheap once the row is set up. */
export function ensureAIUser(): Promise<User> {
  return ensureHouseAccount(AI_SPEC);
}

/** The platform's own account — author of every update and every notice. */
export function ensureOfficialUser(): Promise<User> {
  return ensureHouseAccount(OFFICIAL_SPEC);
}

/**
 * The platform account's id, for a notification's actor.
 *
 * Memoized because a moderation action should not wait on an account lookup, and the
 * id never changes once the row exists. Null on failure rather than a throw: a notice
 * from nobody is still a notice, and the author being told their post was hidden
 * matters more than the avatar beside it.
 */
let officialId: string | null = null;
export async function officialActorId(): Promise<string | null> {
  if (officialId) return officialId;
  try {
    officialId = (await ensureOfficialUser()).id;
  } catch (error) {
    console.warn(
      "[house] notice has no sender:",
      error instanceof Error ? error.message : error,
    );
  }
  return officialId;
}

/**
 * Fill in an admin's own profile, without touching anything they have set.
 *
 * A banner but no logo. `logoKey` wins over `avatarUrl` in {@link resolveAvatarUrl},
 * so minting a mark here would replace a real Google face with a house glyph; the
 * banner slot is empty until somebody fills it, so drawing into it takes nothing away.
 */
export async function ensureAdminProfile(user: User): Promise<void> {
  const preset = findPreset("typewriter");
  const keys = await seedTheme(user.id, {
    tagline: "Admin. Rate the Bakchod.",
    bio:
      "Platform chalata hoon — features, bugs, moderation.\n" +
      `Updates @${OFFICIAL_HANDLE} pe aate hain.`,
    // A built-in preset rather than hand-written HTML, so the profile editor shows
    // which one it started from and an admin can swap it in one click.
    welcomeHtml: preset ? renderPreset(preset, user.displayName) : null,
    welcomePreset: preset ? preset.id : null,
  });
  if (!keys.bannerKey) await mintAsset(user, "BANNER", ADMIN_BANNER);
}

/** Both house accounts, for a caller that wants them to exist before it renders. */
export async function ensureHouseAccounts(): Promise<void> {
  await Promise.all([ensureAIUser(), ensureOfficialUser()]);
}

/** Exported for the tests: house art must be drawable without a font. */
export const __houseInternals = {
  SPARK_MARK,
  CHECK_MARK,
  AI_BANNER,
  OFFICIAL_BANNER,
  ADMIN_BANNER,
  AI_WELCOME,
  OFFICIAL_WELCOME,
  toPng,
};
