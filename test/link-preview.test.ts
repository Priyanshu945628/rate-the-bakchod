import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  isBlockedAddress,
  normalizeTargetUrl,
  parsePreview,
} from "@/lib/link-preview";

/**
 * The parts of link unfurling that can be tested without a network.
 *
 * `isBlockedAddress` and `normalizeTargetUrl` are the security boundary of the whole
 * feature — everything else here is presentation, but those two decide whether a URL
 * somebody typed into a chat can make our server fetch something on our own network.
 * A hole in either is not a rendering bug, so this file leans on them hardest.
 */

describe("normalizeTargetUrl", () => {
  it("accepts ordinary http and https links", () => {
    expect(normalizeTargetUrl("https://example.com/a?b=1")?.href).toBe(
      "https://example.com/a?b=1",
    );
    expect(normalizeTargetUrl("http://example.com")?.href).toBe("http://example.com/");
  });

  it("drops the fragment, which is nobody's business but the reader's", () => {
    expect(normalizeTargetUrl("https://example.com/a#section")?.href).toBe(
      "https://example.com/a",
    );
  });

  it("refuses every scheme but http and https", () => {
    for (const raw of [
      "file:///etc/passwd",
      "ftp://example.com",
      "data:text/html,<b>x",
      "javascript:alert(1)",
      "gopher://example.com",
      "not a url at all",
      "",
    ]) {
      expect(normalizeTargetUrl(raw), raw).toBeNull();
    }
  });

  it("refuses credentials in the URL", () => {
    expect(normalizeTargetUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeTargetUrl("https://user@example.com")).toBeNull();
  });

  it("refuses non-default ports", () => {
    expect(normalizeTargetUrl("http://example.com:8080")).toBeNull();
    expect(normalizeTargetUrl("http://example.com:22")).toBeNull();
    expect(normalizeTargetUrl("http://example.com:80")?.href).toBe("http://example.com/");
    expect(normalizeTargetUrl("https://example.com:443")?.href).toBe(
      "https://example.com/",
    );
  });

  it("refuses names that mean this machine or this network", () => {
    for (const raw of [
      "http://localhost/x",
      "http://LOCALHOST/x",
      "http://api.localhost/x",
      "http://printer.local/x",
      "http://vault.internal/x",
      "http://router.home.arpa/x",
    ]) {
      expect(normalizeTargetUrl(raw), raw).toBeNull();
    }
  });

  it("refuses a private address written as a literal", () => {
    for (const raw of [
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/x",
      "http://[fd00::1]/x",
    ]) {
      expect(normalizeTargetUrl(raw), raw).toBeNull();
    }
  });

  it("still allows a public address written as a literal", () => {
    expect(normalizeTargetUrl("http://8.8.8.8/x")?.href).toBe("http://8.8.8.8/x");
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, unspecified and this-network", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "::", "::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the RFC1918 ranges at their edges", () => {
    for (const ip of [
      "10.0.0.0",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.0",
      "192.168.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    // Just outside 172.16/12 on both sides — public space, and blocking it would
    // quietly break previews for real websites.
    expect(isBlockedAddress("172.15.255.255")).toBe(false);
    expect(isBlockedAddress("172.32.0.0")).toBe(false);
  });

  it("blocks link-local, which is where cloud metadata lives", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    // The IPv6 metadata address used by the same services.
    expect(isBlockedAddress("fe80::a9fe:a9fe")).toBe(true);
  });

  it("blocks a private v4 address dressed up as v6", () => {
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::FFFF:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks carrier NAT, benchmarking, multicast and reserved space", () => {
    for (const ip of [
      "100.64.0.1",
      "100.127.255.255",
      "198.18.0.1",
      "224.0.0.1",
      "239.1.2.3",
      "255.255.255.255",
      "ff02::1",
      "fc00::1",
      "fdff::1",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress("100.63.255.255")).toBe(false);
    expect(isBlockedAddress("100.128.0.0")).toBe(false);
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.190.78", "2606:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks an empty answer rather than treating it as public", () => {
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("   ")).toBe(true);
  });
});

describe("decodeEntities", () => {
  it("decodes the named ones a title actually contains", () => {
    expect(decodeEntities("Bob &amp; Sons")).toBe("Bob & Sons");
    expect(decodeEntities("&lt;tag&gt; &quot;x&quot;")).toBe('<tag> "x"');
    expect(decodeEntities("It&rsquo;s here&hellip;")).toBe("It’s here…");
  });

  it("decodes numeric and hex forms, in either case", () => {
    expect(decodeEntities("&#65;&#x42;&#X43;")).toBe("ABC");
  });

  it("leaves anything it does not know exactly as written", () => {
    expect(decodeEntities("100 &frac12; &notanentity; &#x110000;")).toBe(
      "100 &frac12; &notanentity; &#x110000;",
    );
  });
});

describe("parsePreview", () => {
  it("prefers Open Graph over Twitter over the tab title", () => {
    const html = `
      <title>Tab title</title>
      <meta name="twitter:title" content="Twitter title">
      <meta property="og:title" content="OG title">
      <meta name="description" content="Plain description">
      <meta property="og:description" content="OG description">
    `;
    expect(parsePreview(html)).toEqual({
      title: "OG title",
      description: "OG description",
      iconHref: null,
    });
  });

  it("falls back through Twitter to the tab title", () => {
    expect(
      parsePreview('<title>Tab</title><meta name="twitter:description" content="D">'),
    ).toEqual({ title: "Tab", description: "D", iconHref: null });
  });

  it("reads the page the way the screenshot's link does", () => {
    const html = `<!doctype html><html><head>
      <link rel="icon" href="/favicon.png">
      <meta property="og:title" content="Download Uni Code for Windows and Linux">
      <meta property="og:description" content="Get the latest build.">
    </head><body>ignored</body></html>`;
    expect(parsePreview(html)).toEqual({
      title: "Download Uni Code for Windows and Linux",
      description: "Get the latest build.",
      iconHref: "/favicon.png",
    });
  });

  it("collapses whitespace and decodes entities in what it found", () => {
    const html = `<title>
        Bob   &amp;
        Sons
      </title>`;
    expect(parsePreview(html).title).toBe("Bob & Sons");
  });

  it("handles single-quoted and unquoted attributes", () => {
    const html = `<meta property='og:title' content='Quoted'><link rel=icon href=/i.ico>`;
    expect(parsePreview(html)).toEqual({
      title: "Quoted",
      description: null,
      iconHref: "/i.ico",
    });
  });

  it("takes rel=\"shortcut icon\", and prefers icon over an apple touch tile", () => {
    expect(
      parsePreview('<link rel="apple-touch-icon" href="/big.png">').iconHref,
    ).toBe("/big.png");
    expect(
      parsePreview(
        '<link rel="apple-touch-icon" href="/big.png"><link rel="shortcut icon" href="/small.ico">',
      ).iconHref,
    ).toBe("/small.ico");
  });

  it("ignores a link tag with no href and a meta tag with no content", () => {
    expect(parsePreview('<link rel="icon"><meta property="og:title">')).toEqual({
      title: null,
      description: null,
      iconHref: null,
    });
  });

  it("returns nothing at all for a page with no metadata", () => {
    expect(parsePreview("<html><body><h1>Hello</h1></body></html>")).toEqual({
      title: null,
      description: null,
      iconHref: null,
    });
  });

  it("clamps a description that would otherwise fill the bubble", () => {
    const long = "x".repeat(600);
    const description = parsePreview(
      `<meta property="og:description" content="${long}">`,
    ).description;
    expect(description).toHaveLength(280);
    expect(description?.endsWith("…")).toBe(true);
  });
});
