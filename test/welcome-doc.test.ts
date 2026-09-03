import { describe, expect, it } from "vitest";
import {
  WELCOME_MAX_HEIGHT,
  WELCOME_MIN_HEIGHT,
  WELCOME_SANDBOX,
  buildWelcomeDoc,
  clampWelcomeHeight,
  escapeHtml,
  safeOrigin,
  welcomeCsp,
  welcomeHeaders,
} from "@/lib/welcome-doc";

const ORIGIN = "https://rtb.example";

/**
 * These are the tests that decide whether the feature ships. A profile's HTML
 * running with a visitor's session is account takeover, so each assertion below
 * corresponds to one thing that would have to break for that to become possible.
 */
describe("welcomeCsp", () => {
  const csp = welcomeCsp(ORIGIN);

  it("sandboxes with scripts and nothing else", () => {
    expect(csp).toContain(`sandbox ${WELCOME_SANDBOX}`);
    expect(WELCOME_SANDBOX).toBe("allow-scripts");
  });

  it("never grants allow-same-origin — that single token undoes everything", () => {
    expect(csp).not.toContain("allow-same-origin");
  });

  it("grants none of the other escape hatches", () => {
    for (const token of [
      "allow-forms",
      "allow-popups",
      "allow-modals",
      "allow-top-navigation",
      "allow-downloads",
      "allow-pointer-lock",
      "allow-presentation",
    ]) {
      expect(csp).not.toContain(token);
    }
  });

  it("denies everything by default, which is what blocks phoning home", () => {
    expect(csp).toContain("default-src 'none'");
    // No connect-src directive at all: fetch/XHR/WebSocket/beacon fall through to
    // default-src, so the document cannot ship a visitor's IP anywhere.
    expect(csp).not.toContain("connect-src");
  });

  it("allows images and media from our origin only, never a third party", () => {
    expect(csp).toContain(`img-src ${ORIGIN} data: blob:`);
    expect(csp).toContain(`media-src ${ORIGIN} data: blob:`);
    // A bare `https:` source would let any host be hotlinked, handing every
    // visitor's IP to a server the profile owner controls. The negative lookahead
    // is so the origin's own "https://" does not count as a scheme source.
    expect(/\bhttps:(?!\/\/)/.test(csp)).toBe(false);
    expect(/\bhttp:(?!\/\/)/.test(csp)).toBe(false);
    expect(csp).not.toContain("*");
  });

  it("cannot be reframed elsewhere, submit a form, or retarget its base URL", () => {
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});

describe("welcomeHeaders", () => {
  it("serves HTML with the policy, no referrer, and no sniffing", () => {
    const headers = welcomeHeaders(ORIGIN, true) as Record<string, string>;
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["content-security-policy"]).toBe(welcomeCsp(ORIGIN));
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("revalidates a saved intro and never stores a preview", () => {
    expect((welcomeHeaders(ORIGIN, true) as Record<string, string>)["cache-control"]).toContain(
      "must-revalidate",
    );
    expect((welcomeHeaders(ORIGIN, false) as Record<string, string>)["cache-control"]).toBe(
      "no-store",
    );
  });
});

describe("buildWelcomeDoc", () => {
  it("puts the bridge in a closed script element before the author's HTML", () => {
    const doc = buildWelcomeDoc({ html: "<p>hi</p>" });
    const bridgeEnd = doc.indexOf("</script>");
    expect(bridgeEnd).toBeGreaterThan(-1);
    expect(doc.indexOf("<p>hi</p>")).toBeGreaterThan(bridgeEnd);
    expect(doc).toContain("rtbDone");
    expect(doc).toContain("rtbHeight");
  });

  it("cannot have its bridge terminated by a </script> in the author's HTML", () => {
    // The classic break-out: if the bridge were built after (or around) author
    // HTML, this would close it early and let the author redefine rtbDone.
    const doc = buildWelcomeDoc({ html: "</script><script>window.rtbDone=null</script>" });
    const bridgeEnd = doc.indexOf("</script>");
    const bridge = doc.slice(0, bridgeEnd);
    expect(bridge).toContain("window.rtbDone");
    expect(doc.indexOf("window.rtbDone=null")).toBeGreaterThan(bridgeEnd);
  });

  it("owns no auto-dismiss timer — the parent does, so Skip cannot be declined", () => {
    const doc = buildWelcomeDoc({ html: "" });
    expect(doc).not.toContain("setTimeout");
  });

  it("escapes the title rather than trusting a display name", () => {
    const doc = buildWelcomeDoc({ html: "", title: '<img src=x onerror="alert(1)">' });
    expect(doc).not.toContain("<img src=x");
    expect(doc).toContain("&lt;img src=x");
  });

  it("only ever writes a validated accent into the style block", () => {
    expect(buildWelcomeDoc({ html: "", accent: "#abcdef" })).toContain("--accent:#abcdef");
    // Anything else falls back rather than being interpolated.
    const doc = buildWelcomeDoc({ html: "", accent: "red;background-image:linear-gradient(a,b)" });
    expect(doc).not.toContain("linear-gradient");
    expect(doc).toContain("--accent:#f4f4f5");
  });

  it("emits no gradient of its own", () => {
    const doc = buildWelcomeDoc({ html: "", accent: "#abcdef" });
    expect(/(linear|radial|conic|repeating)-gradient/.test(doc)).toBe(false);
  });

  it("passes the author's HTML through verbatim — no sanitiser, by design", () => {
    const html = '<canvas id="c"></canvas><script>document.title="ok"</script>';
    expect(buildWelcomeDoc({ html })).toContain(html);
  });
});

describe("safeOrigin", () => {
  it("reduces a site URL to a bare origin", () => {
    expect(safeOrigin("https://rtb.example/some/path?x=1")).toBe("https://rtb.example");
    expect(safeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("degrades to 'self' rather than throwing on a broken env value", () => {
    expect(safeOrigin("not a url")).toBe("'self'");
    expect(safeOrigin("")).toBe("'self'");
  });
});

describe("clampWelcomeHeight", () => {
  it("keeps a child's requested height inside the allowed band", () => {
    expect(clampWelcomeHeight(300)).toBe(300);
    expect(clampWelcomeHeight(10)).toBe(WELCOME_MIN_HEIGHT);
    expect(clampWelcomeHeight(99_999)).toBe(WELCOME_MAX_HEIGHT);
  });

  it("does not let a hostile value through as a height", () => {
    // A non-finite number is not "very tall", it is nonsense — so it falls back to
    // the smallest frame rather than the largest.
    expect(clampWelcomeHeight(Number.NaN)).toBe(WELCOME_MIN_HEIGHT);
    expect(clampWelcomeHeight(Number.POSITIVE_INFINITY)).toBe(WELCOME_MIN_HEIGHT);
    expect(clampWelcomeHeight(-500)).toBe(WELCOME_MIN_HEIGHT);
  });
});

describe("escapeHtml", () => {
  it("neutralises every character that could start markup or close an attribute", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
