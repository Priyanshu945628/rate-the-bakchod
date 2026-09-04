import "server-only";

/**
 * What a pasted link is.
 *
 * A link in a chat is an address a stranger chose, and this is the one place in the
 * app where the *server* goes and fetches one. That is the whole reason this module
 * is as long as it is: everything here that is not parsing HTML exists to stop a
 * message reading `http://169.254.169.254/latest/meta-data/` from turning our own
 * network into somebody's browser.
 *
 * The rules, in order of how much they matter:
 *
 *  - Only `http:` and `https:`, only default ports, no credentials in the URL.
 *  - Every hostname is resolved first, and *every* address it resolves to has to be
 *    public. One private answer among four rejects the whole name.
 *  - Redirects are followed by hand, at most twice, each hop re-validated. `fetch`'s
 *    own redirect following would skip all of the above from the second hop on.
 *  - Five seconds, 256 KB, `text/html` only. A preview is a nicety; it does not get
 *    to hold a request open or read a DVD image looking for a `<title>`.
 *  - The favicon is fetched by us and inlined as a `data:` URL. Handing the reader a
 *    remote `src` would let the site count everyone in the thread who scrolled past.
 *
 * The gap that remains, honestly: Node's `fetch` resolves the name again itself, so a
 * DNS answer that is public when we check it and private a millisecond later would get
 * through. Closing that needs a dispatcher that pins the address, which is a lot of
 * machinery for a chat card — the pre-check still stops every static private address,
 * which is what a pasted link actually contains.
 */

import { lookup } from "node:dns/promises";
import type { ClientLinkPreview } from "./types";

/** Long enough for a slow site, short enough that nobody watches a spinner. */
const TIMEOUT_MS = 5_000;
/** `<head>` lives at the top of the document. Anything past this is not metadata. */
const MAX_HTML_BYTES = 256 * 1024;
/** A favicon that does not fit in this is not a favicon. */
const MAX_ICON_BYTES = 32 * 1024;
/** `example.com` → `www.example.com` → canonical host is two. Three is a loop. */
const MAX_HOPS = 2;

/** Named so a site's logs show what we are and that we are not a person. */
const USER_AGENT = "RateTheBakchodBot/1.0 (+link preview)";

/** Clamps, so one long `og:description` cannot become a wall of text in a bubble. */
const MAX_TITLE = 140;
const MAX_DESCRIPTION = 280;

// ---------------------------------------------------------------------------
// Where we are allowed to go
// ---------------------------------------------------------------------------

/** Names that mean "this machine", before DNS gets a say. */
const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

/** Suffixes reserved for private networks. Never a website worth previewing. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * The URL we are willing to fetch, or null.
 *
 * Also the redirect validator, which is why it takes a string and not a `URL` —
 * a `Location` header is joined against the current hop and comes back through here,
 * so hop two is held to exactly the rules hop one was.
 */
export function normalizeTargetUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // `http://user:pass@host/` — a credential in a pasted link is either a mistake or
  // an attempt to authenticate as us somewhere.
  if (url.username !== "" || url.password !== "") return null;
  // Default ports only. Public websites are on 80 and 443; the interesting things on
  // an internal network are on everything else.
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return null;

  const host = url.hostname.toLowerCase();
  if (host === "" || LOCAL_HOSTS.has(host)) return null;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  // A bare `[::1]`-style literal arrives here with the brackets still on.
  if (isBlockedAddress(host.replace(/^\[|\]$/g, ""))) return null;

  // The fragment is the reader's business and never ours to send.
  url.hash = "";
  return url;
}

/** 0-255 in four dotted parts, or null if this is not an IPv4 literal at all. */
function parseV4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts: [number, number, number, number] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
  ];
  return parts.some((n) => n > 255) ? null : parts;
}

/**
 * Whether an address is one we must never fetch.
 *
 * Exported for `test/link-preview.test.ts`. This function is the security boundary of
 * the whole feature — a missing range here is not a rendering bug, it is a request
 * from inside our network to something that trusts anything from inside our network,
 * and the cloud metadata endpoint on `169.254.169.254` is the reason that matters.
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (addr === "") return true;

  // `::ffff:127.0.0.1` reaches exactly what `127.0.0.1` reaches.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr)?.[1];
  if (mapped) return isBlockedAddress(mapped);

  const v4 = parseV4(addr);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, and cloud metadata with it
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // IETF protocol assignments, documentation
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (!addr.includes(":")) {
    // Not a literal address at all — a hostname. Whether *it* is allowed is DNS's
    // answer to give, not this function's, so nothing is blocked on the name alone.
    return false;
  }

  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  // 6to4 and NAT64 wrap a v4 address; `fc00::/7`, `fe80::/10` and `ff00::/8` are
  // private, link-local and multicast. All of them are decided by the first group.
  const group = Number.parseInt(addr.split(":")[0] || "0", 16);
  if (!Number.isFinite(group)) return true;
  if (group >= 0xfc00 && group <= 0xfdff) return true; // unique-local
  if (group >= 0xfe80 && group <= 0xfebf) return true; // link-local
  if (group >= 0xff00) return true; // multicast
  if (group === 0x2002 || group === 0x0064) return true; // 6to4, NAT64 well-known
  return false;
}

/**
 * Resolve, check every answer, then fetch — following redirects by hand.
 *
 * `lookup` with `all` because a name with an A record on the public internet and a
 * second one on 10.x is a name we must refuse, not a coin flip.
 */
async function guardedFetch(
  start: URL,
  accept: string,
): Promise<{ res: Response; url: URL } | null> {
  let target = start;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const addresses = await lookup(target.hostname, { all: true, verbatim: true }).catch(
      () => [],
    );
    if (addresses.length === 0) return null;
    if (addresses.some((entry) => isBlockedAddress(entry.address))) return null;

    const res = await fetch(target, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        accept,
        "accept-language": "en",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      void res.body?.cancel();
      if (!location) return null;
      let next: URL | null = null;
      try {
        next = normalizeTargetUrl(new URL(location, target).href);
      } catch {
        next = null;
      }
      if (!next) return null;
      target = next;
      continue;
    }

    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    return { res, url: target };
  }

  return null;
}

/**
 * At most `cap` bytes of a body, then hang up.
 *
 * `content-length` is not trusted for this — it is a claim by the same server whose
 * body we are trying not to read all of.
 */
async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        size += value.byteLength;
      }
    }
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(Math.min(size, cap));
  let at = 0;
  for (const chunk of chunks) {
    if (at >= out.length) break;
    const take = Math.min(chunk.byteLength, out.length - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
  }
  return out;
}

/** The charset the response claims, honoured if Node knows it. */
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // An unknown label is not worth failing the preview over.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

/** `name="x"`, `name='x'` and bare `name=x`, which are all legal. */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(ATTR_RE)) {
    const name = (m[1] ?? "").toLowerCase();
    // First wins, which is what a browser does with a repeated attribute.
    if (name && !out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** The handful that actually turn up in titles. The rest stay as written. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function codePoint(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return null;
  try {
    return String.fromCodePoint(value);
  } catch {
    return null;
  }
}

/**
 * `&amp;` → `&`, and the numeric forms.
 *
 * Exported for the tests. An entity left undecoded is the difference between a title
 * that reads *Bob &amp; Sons* and one that reads like a person wrote it.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) return codePoint(Number.parseInt(key.slice(2), 16)) ?? whole;
    if (key.startsWith("#")) return codePoint(Number.parseInt(key.slice(1), 10)) ?? whole;
    return NAMED_ENTITIES[key] ?? whole;
  });
}

/** Decoded, collapsed to single spaces, trimmed, clamped — or null if empty. */
function clean(value: string | null | undefined, limit: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export interface ParsedPreview {
  title: string | null;
  description: string | null;
  /** Still relative, as the document wrote it. Resolved against the final URL. */
  iconHref: string | null;
}

/**
 * Title, description and icon out of a page's `<head>`.
 *
 * A scanner over `<meta>` and `<link>` tags rather than a DOM: this runs on untrusted
 * HTML, and the alternative is a parser dependency for three strings. Open Graph is
 * preferred, then Twitter's copy of it, then what the page tells a browser tab.
 *
 * Exported for `test/link-preview.test.ts`.
 */
export function parsePreview(html: string): ParsedPreview {
  const meta = new Map<string, string>();
  let icon: { href: string; rank: number } | null = null;

  for (const m of html.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
    const attrs = attributes(m[2] ?? "");

    if ((m[1] ?? "").toLowerCase() === "meta") {
      const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
      const content = attrs.get("content");
      if (key !== "" && content && !meta.has(key)) meta.set(key, content);
      continue;
    }

    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attrs.get("href");
    if (!href) continue;
    // `rel="icon"` is the small one meant for exactly this slot; an apple-touch-icon
    // is a 180px app tile, fine as a fallback but a waste of the byte budget first.
    const rank = rel.includes("icon") ? 2 : rel.includes("apple-touch-icon") ? 1 : 0;
    if (rank > 0 && (!icon || rank > icon.rank)) icon = { href, rank };
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  return {
    title:
      clean(meta.get("og:title"), MAX_TITLE) ??
      clean(meta.get("twitter:title"), MAX_TITLE) ??
      clean(titleTag, MAX_TITLE),
    description:
      clean(meta.get("og:description"), MAX_DESCRIPTION) ??
      clean(meta.get("twitter:description"), MAX_DESCRIPTION) ??
      clean(meta.get("description"), MAX_DESCRIPTION),
    iconHref: icon?.href ?? null,
  };
}

// ---------------------------------------------------------------------------
// The icon
// ---------------------------------------------------------------------------

/**
 * Types that may become a `data:` URL.
 *
 * An allowlist rather than a `startsWith("image/")` check, because the value ends up
 * inside an attribute the reader's browser will act on, and it arrived in a header
 * written by the site being previewed. SVG is on the list: as an `<img>` source it
 * cannot run script.
 */
const ICON_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * The site's icon, inlined.
 *
 * `/favicon.ico` is tried when the document declared nothing, because most sites
 * still have one there and a card without the little square looks unfinished.
 */
async function fetchIcon(base: URL, declared: string | null): Promise<string | null> {
  const candidates = [declared, "/favicon.ico"].filter(
    (href): href is string => typeof href === "string" && href.trim() !== "",
  );

  for (const candidate of candidates) {
    let url: URL | null = null;
    try {
      url = normalizeTargetUrl(new URL(candidate, base).href);
    } catch {
      url = null;
    }
    if (!url) continue;

    const hit = await guardedFetch(url, "image/*").catch(() => null);
    if (!hit) continue;

    const type = (hit.res.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!type || !ICON_TYPES.has(type)) {
      void hit.res.body?.cancel();
      continue;
    }

    const bytes = await readCapped(hit.res, MAX_ICON_BYTES + 1);
    // Over the cap by one byte means it was truncated, and half an image is worse
    // than none — a broken `<img>` in the card.
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) continue;

    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

/** Everything above, once, with no caching. `linkPreview` is what callers want. */
async function fetchLinkPreview(raw: string): Promise<ClientLinkPreview | null> {
  const target = normalizeTargetUrl(raw);
  if (!target) return null;

  const hit = await guardedFetch(target, "text/html,application/xhtml+xml;q=0.9");
  if (!hit) return null;

  const contentType = hit.res.headers.get("content-type") ?? "";
  if (!/^\s*(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    void hit.res.body?.cancel();
    return null;
  }

  const bytes = await readCapped(hit.res, MAX_HTML_BYTES);
  if (!bytes || bytes.byteLength === 0) return null;

  const parsed = parsePreview(decodeHtml(bytes, contentType));
  // A card with nothing on it but the host is less use than the link already was.
  if (!parsed.title && !parsed.description) return null;

  return {
    url: hit.url.href,
    host: hit.url.hostname.toLowerCase().replace(/^www\./, ""),
    title: parsed.title,
    description: parsed.description,
    icon: await fetchIcon(hit.url, parsed.iconHref),
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  value: ClientLinkPreview | null;
}

/** Six hours. A page's title is not news, and this is a chat card. */
const TTL_OK = 6 * 60 * 60 * 1000;
/** Failures expire fast, so a site that was down at lunch unfurls by dinner. */
const TTL_FAIL = 10 * 60 * 1000;
/** Bounded, because the keys come from whatever people paste. */
const MAX_ENTRIES = 500;

const globalCache = globalThis as unknown as {
  __rtbLinkPreview?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> = (globalCache.__rtbLinkPreview ??= new Map());

/**
 * Requests in flight, so two people opening the same thread fetch the page once.
 *
 * Not on `globalThis` — losing this map across a hot reload costs one duplicate
 * outbound request, and nothing else.
 */
const inFlight = new Map<string, Promise<ClientLinkPreview | null>>();

/**
 * A preview, from memory when we have one.
 *
 * The cache is the difference between a link in a busy thread being fetched once and
 * being fetched once per reader per scroll. Failures are cached too, and for the same
 * reason: a URL that 404s does not get to cost an outbound request every time somebody
 * looks at the message.
 */
export async function linkPreview(raw: string): Promise<ClientLinkPreview | null> {
  const target = normalizeTargetUrl(raw);
  if (!target) return null;
  const key = target.href;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? TTL_OK : TTL_FAIL)) {
    // Re-inserted, so eviction order is least-recently-used and a link people keep
    // opening is not dropped for one nobody has looked at since.
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }

  const running = inFlight.get(key);
  if (running) return running;

  const job = fetchLinkPreview(key)
    .catch(() => null)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, job);
  return job;
}
