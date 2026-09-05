import "server-only";

import sharp from "sharp";

/**
 * The AI's picture posts.
 *
 * Claude cannot generate images — no Anthropic model can — so the bot does the next
 * honest thing: it writes the line, and the server sets it. The layout, the palette
 * and every glyph of markup here are ours; the model supplies one string, which is
 * escaped and dropped into a slot. That is deliberate and not merely convenient —
 * model-authored SVG would be untrusted markup handed to librsvg, which resolves
 * external references, and the injection surface of "one escaped text node" is zero.
 *
 * Output is PNG on purpose. It goes back through `normalizeUpload` like any other
 * upload, which sniffs it, re-encodes to WebP, hashes it and encrypts it — the bot
 * gets no private road into the media pipeline.
 *
 * Flat, per the theme rule: no gradients outside the chat surface.
 */

/** Square, because a feed card is width-constrained and a square never crops. */
const SIZE = 1080;
/** Text box, leaving a margin the border can breathe inside. */
const PAD = 110;
const BOX = SIZE - PAD * 2;

/** Base palette from `app/globals.css`. A baked image cannot follow the theme. */
const BG = "#08090a";
const PANEL = "#0f1011";
const LINE = "#2e3034";
const INK = "#f4f4f5";
const MUTED = "#8f9299";
const FAINT = "#63666e";

/**
 * The font stack, in the order a container is likely to have one.
 *
 * librsvg resolves these through fontconfig, so what matters is what is installed on
 * the box rather than what a browser would do. A slim image may have none of them,
 * which is what {@link canRenderText} is for.
 */
const FONTS = "DejaVu Sans, Liberation Sans, Noto Sans, Arial, Helvetica, sans-serif";

/** Rough advance width of one character, as a fraction of font size. */
const ADVANCE = 0.53;

export type CardLayout = "certificate" | "notice" | "confession";

/** The fixed half of each card: everything except the line the model wrote. */
const LAYOUTS: Record<CardLayout, { eyebrow: string; footer: string }> = {
  certificate: { eyebrow: "certified bakchod", footer: "rate the bakchod" },
  notice: { eyebrow: "public notice", footer: "issued by bakchod ai" },
  confession: { eyebrow: "today's confession", footer: "bakchod ai" },
};

export const CARD_LAYOUTS = Object.keys(LAYOUTS) as CardLayout[];

/**
 * SVG has no text wrapping, so lines are measured here.
 *
 * Wrapped on words, with a long single word hard-split rather than allowed to run off
 * the edge. The measurement is an estimate from the font size — exact metrics would
 * mean loading the face, and being a character or two conservative per line costs
 * nothing on a card with this much margin.
 */
function wrap(text: string, fontSize: number, maxLines: number): string[] {
  const perLine = Math.max(Math.floor(BOX / (fontSize * ADVANCE)), 8);
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += perLine) {
        lines.push(word.slice(i, i + perLine));
      }
      current = lines.pop() ?? "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[\s,.;:]+$/, "")}…`;
  return kept;
}

/**
 * The one place untrusted text meets markup.
 *
 * Every model-written character on the card goes through here. Apostrophes and
 * quotes are escaped as well as the three that strictly need it, because the same
 * helper is used for attribute values.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Bigger for a short line. A 200-character roast set at 72px is a wall. */
function sizeFor(length: number): number {
  if (length <= 70) return 76;
  if (length <= 130) return 60;
  return 48;
}

/** The decoration that distinguishes one layout from another. */
function ornament(layout: CardLayout, midY: number): string {
  if (layout === "certificate") {
    return `
    <rect x="${PAD}" y="${midY - 150}" width="${BOX}" height="2" fill="${LINE}"/>
    <rect x="${PAD}" y="${midY + 150}" width="${BOX}" height="2" fill="${LINE}"/>`;
  }
  if (layout === "notice") {
    return `<rect x="${PAD}" y="${midY - 130}" width="6" height="260" rx="3" fill="${MUTED}"/>`;
  }
  return `<text x="${PAD - 6}" y="${midY - 96}" font-family="${FONTS}" font-size="180" fill="${LINE}">&#8220;</text>`;
}

function buildSvg(layout: CardLayout, line: string): string {
  const { eyebrow, footer } = LAYOUTS[layout];
  const fontSize = sizeFor(line.length);
  const lines = wrap(line, fontSize, 7);
  const leading = Math.round(fontSize * 1.28);
  const midY = SIZE / 2;
  // Centred as a block: the first baseline sits half the stack above the middle.
  const firstBaseline = Math.round(midY - ((lines.length - 1) * leading) / 2 + fontSize * 0.34);

  const body = lines
    .map(
      (text, i) =>
        `<tspan x="${SIZE / 2}" y="${firstBaseline + i * leading}">${escapeXml(text)}</tspan>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>
  <rect x="28" y="28" width="${SIZE - 56}" height="${SIZE - 56}" rx="44" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>
  ${ornament(layout, midY)}
  <text x="${SIZE / 2}" y="${PAD + 24}" text-anchor="middle" font-family="${FONTS}" font-size="30" font-weight="bold" letter-spacing="7" fill="${MUTED}">${escapeXml(
    eyebrow.toUpperCase(),
  )}</text>
  <text text-anchor="middle" font-family="${FONTS}" font-size="${fontSize}" font-weight="bold" fill="${INK}">${body}</text>
  <text x="${SIZE / 2}" y="${SIZE - PAD + 10}" text-anchor="middle" font-family="${FONTS}" font-size="26" letter-spacing="5" fill="${FAINT}">${escapeXml(
    footer.toUpperCase(),
  )}</text>
</svg>`;
}

/**
 * Whether this container can draw text at all.
 *
 * librsvg silently renders nothing when fontconfig has no face for any family in the
 * stack, and a slim deploy image is a real possibility — so rather than posting blank
 * plaques for months, the answer is probed once with white text on black and cached.
 * `max` on the luma channel is 0 when nothing was drawn and near 255 when it was.
 *
 * The caller falls back to an ordinary text post on false. That is the difference
 * between a bot that looks broken and one that just isn't posting pictures.
 */
let textCapable: Promise<boolean> | null = null;

export function canRenderText(): Promise<boolean> {
  textCapable ??= sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#000"/><text x="12" y="56" font-family="${FONTS}" font-size="48" fill="#fff">Bakchod</text></svg>`,
    ),
  )
    .greyscale()
    .stats()
    .then((stats) => (stats.channels[0]?.max ?? 0) > 128)
    .catch(() => false);
  return textCapable;
}

/**
 * Render one card, or null when this container cannot set type.
 *
 * PNG rather than WebP because the caller hands it straight to `normalizeUpload`,
 * which sniffs the magic bytes and re-encodes anyway.
 */
export async function renderBakchodCard(
  layout: CardLayout,
  line: string,
): Promise<Buffer | null> {
  const text = line.trim();
  if (!text) return null;
  if (!(await canRenderText())) return null;

  return sharp(Buffer.from(buildSvg(layout, text.slice(0, 240))))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Exported for `test/ai-card.test.ts`, which asserts the escaping and the wrap. */
export const __cardInternals = { buildSvg, wrap, escapeXml, sizeFor };

