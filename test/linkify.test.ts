import { describe, expect, it } from "vitest";
import { splitLinks } from "@/components/messages/linkify";

/**
 * The one regex standing between a pasted DM and an anchor tag.
 *
 * Two of these are security tests rather than formatting tests: nothing that is not
 * `http:` or `https:` may ever end up in an `href`, and a bare `www.` host has to be
 * given a scheme rather than passed through as a relative path — `href="www.x.com"`
 * navigates to `/messages/www.x.com`, which is a broken link that looks like a
 * working one. The rest pin down where a URL stops, which is the part with the edge
 * cases in it.
 */

/** Just the hrefs, in order — what actually reaches the DOM. */
const hrefs = (text: string) =>
  splitLinks(text)
    .map((part) => part.href)
    .filter((href): href is string => href !== null);

/** The visible text, reassembled. Nothing may be dropped or duplicated. */
const flat = (text: string) =>
  splitLinks(text)
    .map((part) => part.text)
    .join("");

describe("splitLinks", () => {
  it("leaves a message with no link as one plain run", () => {
    const parts = splitLinks("no links here");
    expect(parts).toEqual([{ text: "no links here", href: null }]);
  });

  it("finds a link in the middle of a sentence", () => {
    expect(hrefs("look at https://x.com/status/1 then tell me")).toEqual([
      "https://x.com/status/1",
    ]);
  });

  it("gives a bare www host a scheme", () => {
    expect(hrefs("www.example.com")).toEqual(["https://www.example.com"]);
  });

  it("matches a schemed www host once, not twice", () => {
    expect(hrefs("https://www.example.com/a")).toEqual(["https://www.example.com/a"]);
  });

  it("finds every link in a message", () => {
    expect(hrefs("https://a.com and https://b.com and www.c.com")).toEqual([
      "https://a.com",
      "https://b.com",
      "https://www.c.com",
    ]);
  });

  it("leaves the full stop out of the href", () => {
    const parts = splitLinks("see https://x.com.");
    expect(hrefs("see https://x.com.")).toEqual(["https://x.com"]);
    expect(parts.at(-1)).toEqual({ text: ".", href: null });
  });

  it("does not swallow a closing bracket", () => {
    expect(hrefs("(see https://x.com/a)")).toEqual(["https://x.com/a"]);
  });

  it("keeps a trailing comma out of a list of links", () => {
    expect(hrefs("https://a.com, https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("never emits a scheme other than http or https", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "JaVaScRiPt:alert(1)",
    ]) {
      expect(hrefs(hostile)).toEqual([]);
    }
  });

  it("does not treat a scheme smuggled into a path as a new link", () => {
    // The whole thing is one match, so the inner `javascript:` never becomes an href
    // of its own — and the outer href starts with https, which is what matters.
    for (const href of hrefs("https://x.com/javascript:alert(1)")) {
      expect(href.startsWith("https://")).toBe(true);
    }
  });

  it("ignores a scheme with nothing after it", () => {
    expect(hrefs("https:// and www. on their own")).toEqual([]);
  });

  it("preserves the message text exactly", () => {
    for (const text of [
      "look at https://x.com/status/1 then tell me",
      "(see https://x.com/a) and www.b.com.",
      "https://a.com, https://b.com",
      "no links here",
      "https:// and www. on their own",
    ]) {
      expect(flat(text)).toBe(text);
    }
  });
});
