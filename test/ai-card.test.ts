import { describe, expect, it } from "vitest";
import { CARD_LAYOUTS, __cardInternals, type CardLayout } from "@/lib/ai/card";

/**
 * The AI's picture posts are model-written text dropped into server-written markup,
 * which makes `escapeXml` the single boundary between an untrusted string and
 * librsvg — a renderer that resolves external references. That is the reason this
 * file exists; the wrap and the size ramp are here because a card that silently
 * runs off its own edge is invisible until somebody scrolls past one.
 */

const { buildSvg, wrap, escapeXml, sizeFor } = __cardInternals;

describe("escapeXml", () => {
  it("escapes every character that can change the markup", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("escapes the ampersand first, so an entity is not double-decoded", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary Hinglish untouched", () => {
    const line = "Bhai ne apni hi izzat ka encounter kar diya 🫡";
    expect(escapeXml(line)).toBe(line);
  });
});

describe("buildSvg", () => {
  it("neutralises markup in the model's line", () => {
    const svg = buildSvg(
      "notice",
      `</text><image href="file:///etc/passwd"/><text>`,
    );
    expect(svg).not.toContain("<image");
    expect(svg).toContain("&lt;image");
    // The one `</text>` per text element is ours; none came from the payload.
    expect(svg.match(/<text[\s>]/g)?.length).toBe(svg.match(/<\/text>/g)?.length);
  });

  it("neutralises a script payload", () => {
    const svg = buildSvg("certificate", "<script>fetch('http://x')</script>");
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("opens and closes a single svg root", () => {
    const svg = buildSvg("confession", "kuch bhi");
    expect(svg.match(/<svg[\s>]/g)).toHaveLength(1);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("prints each layout's own fixed copy, uppercased and escaped", () => {
    expect(buildSvg("certificate", "x")).toContain("CERTIFIED BAKCHOD");
    expect(buildSvg("notice", "x")).toContain("PUBLIC NOTICE");
    expect(buildSvg("confession", "x")).toContain("TODAY&apos;S CONFESSION");
  });

  it("draws a different ornament for every layout", () => {
    const svgs = CARD_LAYOUTS.map((layout) => buildSvg(layout, "same line"));
    expect(new Set(svgs).size).toBe(CARD_LAYOUTS.length);
  });

  it("keeps a long line inside seven lines, ending in an ellipsis", () => {
    const svg = buildSvg("confession", "bakchodi ".repeat(40));
    const tspans = svg.match(/<tspan /g) ?? [];
    expect(tspans.length).toBeLessThanOrEqual(7);
    expect(svg).toContain("…</tspan>");
  });
});

describe("wrap", () => {
  it("leaves a short line alone", () => {
    expect(wrap("teen shabd bas", 48, 7)).toEqual(["teen shabd bas"]);
  });

  it("returns nothing for whitespace", () => {
    expect(wrap("   \n  ", 48, 7)).toEqual([]);
  });

  it("keeps every word, in order", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
    expect(wrap(words.join(" "), 60, 20).join(" ").split(/\s+/)).toEqual(words);
  });

  it("hard-splits a word too long to fit rather than letting it run off", () => {
    const lines = wrap("a".repeat(120), 76, 7);
    expect(lines.length).toBeGreaterThan(1);
    // Reassembled, nothing is lost — it is a split, not a truncation.
    expect(lines.join("")).toBe("a".repeat(120));
  });

  it("never returns more lines than asked for", () => {
    for (const maxLines of [1, 2, 5]) {
      expect(wrap("bakchodi ".repeat(60), 48, maxLines).length).toBeLessThanOrEqual(
        maxLines,
      );
    }
  });

  it("marks a truncated line with an ellipsis and no dangling punctuation", () => {
    const lines = wrap("pehla dusra teesra, chautha paanchva chhatha", 76, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
    expect(lines[0]).not.toMatch(/[\s,.;:]…$/);
  });

  it("does not mark a line that fitted", () => {
    expect(wrap("bas itna", 48, 3).join("")).not.toContain("…");
  });

  it("gives a smaller font more characters per line", () => {
    const text = "word ".repeat(40);
    expect(wrap(text, 48, 20).length).toBeLessThan(wrap(text, 76, 20).length);
  });
});

describe("sizeFor", () => {
  it("sets a short line big and a long one small", () => {
    expect(sizeFor(1)).toBe(76);
    expect(sizeFor(70)).toBe(76);
    expect(sizeFor(71)).toBe(60);
    expect(sizeFor(130)).toBe(60);
    expect(sizeFor(131)).toBe(48);
    expect(sizeFor(240)).toBe(48);
  });

  it("never grows with length", () => {
    let previous = Infinity;
    for (let length = 0; length <= 300; length += 10) {
      const size = sizeFor(length);
      expect(size).toBeLessThanOrEqual(previous);
      previous = size;
    }
  });
});

describe("CARD_LAYOUTS", () => {
  /**
   * The bot picks from this list at random, so a layout added to the type without
   * copy in `LAYOUTS` would surface as a card with a blank eyebrow one time in three.
   */
  it("names every layout the renderer has copy for", () => {
    const expected: CardLayout[] = ["certificate", "notice", "confession"];
    expect([...CARD_LAYOUTS].sort()).toEqual([...expected].sort());
  });
});
