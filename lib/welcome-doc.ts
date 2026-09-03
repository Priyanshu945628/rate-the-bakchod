/**
 * Builds the sandboxed document that a profile's welcome animation runs inside.
 *
 * Pure and dependency-free on purpose: this is the one piece of the feature that
 * has to be provably right, so it is unit-tested rather than eyeballed. Nothing
 * here touches the database, the request, or `process.env`.
 *
 * ## Why the HTML gets its own document
 *
 * A `<script>` from my profile, rendered into the page *you* are viewing, runs
 * with your session — it can read your auth cookie and post as you. That is
 * account takeover, not a moderation question, so "this platform is transparent"
 * does not make it acceptable.
 *
 * The fix is not to strip the HTML; it is to give it an origin where scripts run
 * freely and reach nothing. A sandbox without `allow-same-origin` produces an
 * *opaque* origin: `document.cookie` is empty, `localStorage` throws,
 * `window.parent` is cross-origin and unreadable, and `default-src 'none'` means
 * the document cannot even open a `fetch` to phone home with a visitor's IP.
 *
 * ## Why a route and not `srcdoc`
 *
 * A `srcdoc` frame **inherits the parent page's CSP**. The day this app grows a
 * real app-wide CSP, every user's animation would silently die. A document with
 * its own URL owns its own policy and is immune to that.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Clamp range for a frame height the child asks for, in CSS pixels. */
export const WELCOME_MIN_HEIGHT = 160;
export const WELCOME_MAX_HEIGHT = 600;

/** The sandbox flags, in one place so the frame attribute and CSP cannot drift. */
export const WELCOME_SANDBOX = "allow-scripts";

/**
 * The response CSP for a welcome document.
 *
 * `selfOrigin` is spelled out rather than relying on `'self'`: under a sandbox
 * the document's origin is opaque, and whether `'self'` still matches the
 * serving origin is implementation-dependent. Naming the origin makes "your own
 * banner loads, nobody else's tracking pixel does" a guarantee instead of a
 * hope.
 */
export function welcomeCsp(selfOrigin: string): string {
  const origin = safeOrigin(selfOrigin);
  return [
    // Opaque origin. Set here as well as on the iframe attribute so that editing
    // one of the two away later does not quietly undo the whole security model.
    `sandbox ${WELCOME_SANDBOX}`,
    // Nothing loads unless a directive below says otherwise. In particular this
    // denies connect-src, so the document cannot beacon a visitor's IP out.
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    // Same-origin assets only — a third-party <img> would hand every visitor's
    // IP and User-Agent to a server the profile owner controls.
    `img-src ${origin} data: blob:`,
    `media-src ${origin} data: blob:`,
    "font-src data:",
    // Nobody else may frame this and pass it off as their own page.
    "frame-ancestors 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Headers every welcome response carries. */
export function welcomeHeaders(selfOrigin: string, cacheable: boolean): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": welcomeCsp(selfOrigin),
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    // A preview is per-request and must never be cached; a saved intro changes
    // rarely but must not be stale after an edit, so it revalidates.
    "cache-control": cacheable ? "private, max-age=0, must-revalidate" : "no-store",
  };
}

export interface WelcomeDocInput {
  /** The author's HTML, exactly as stored. Never sanitised — see the header. */
  html: string;
  /** Shown in the frame's own title; escaped before use. */
  title?: string;
  /** Flat hex, exposed to the document as `--accent`. Rejected if malformed. */
  accent?: string | null;
}

/**
 * The bridge prepended to every document, so authors get the two things they
 * actually need without knowing the protocol.
 *
 * `postMessage` is the only channel a sandbox leaves open, and it is one-way in
 * practice: the child cannot read the parent, only shout at it. The parent
 * validates `event.source` before believing anything.
 *
 * Note what is *not* here: no auto-dismiss timer. The parent owns that, because
 * a timer inside a hostile document is a timer that hostile document can simply
 * decline to fire.
 */
const BRIDGE = `(function () {
  function send(m) { try { parent.postMessage(m, "*"); } catch (e) {} }
  window.rtbDone = function () { send({ __rtb: "done" }); };
  window.rtbHeight = function (px) {
    var n = Number(px);
    if (isFinite(n) && n > 0) send({ __rtb: "height", px: n });
  };
  function measure() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(d ? d.scrollHeight : 0, b ? b.scrollHeight : 0);
    if (h > 0) window.rtbHeight(h);
  }
  window.addEventListener("load", measure);
  if (typeof ResizeObserver === "function") {
    try { new ResizeObserver(measure).observe(document.documentElement); } catch (e) {}
  }
})();`;

/**
 * The ground the author's HTML lands on. The hexes are literals rather than theme
 * variables because this document has its own opaque origin — it cannot see the
 * app's stylesheet — so they are the one place the palette has to be repeated by
 * hand if it ever changes again.
 */
const BASE_CSS = `:root{color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:#08090a;color:#f4f4f5;overflow:hidden;
  font:400 15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  display:flex;align-items:center;justify-content:center;text-align:center;
  padding:24px;
}
a{color:var(--accent)}
@media (prefers-reduced-motion: reduce){
  *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}`;

/**
 * Assembles the full document.
 *
 * Ordering is load-bearing: the bridge is a complete, closed `<script>` element
 * *before* the author's HTML, so a stray `</script>` in that HTML cannot break
 * out of the bridge and redefine it. Only escaped values are ever placed inside
 * a `<style>` or an attribute; the author's HTML goes in the body, where being
 * arbitrary markup is the entire point.
 */
export function buildWelcomeDoc(input: WelcomeDocInput): string {
  const title = escapeHtml(input.title ?? "Intro");
  const accent = input.accent && HEX_RE.test(input.accent) ? input.accent : "#f4f4f5";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>:root{--accent:${accent}}
${BASE_CSS}</style>
<script>${BRIDGE}</script>
</head>
<body>
${input.html}
</body>
</html>`;
}

/** Minimal text-context escape. Used only for the title. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Reduce a configured site URL to a bare origin. A malformed value falls back to
 * `'self'` rather than throwing — a broken env var should degrade the intro's
 * images, not 500 the route.
 */
export function safeOrigin(siteUrl: string): string {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return "'self'";
  }
}

/** Clamp a height a child asked for. Exported so the parent and tests agree. */
export function clampWelcomeHeight(px: number): number {
  if (!Number.isFinite(px)) return WELCOME_MIN_HEIGHT;
  return Math.min(WELCOME_MAX_HEIGHT, Math.max(WELCOME_MIN_HEIGHT, Math.round(px)));
}
