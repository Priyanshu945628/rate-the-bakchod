/**
 * Turning a pasted URL in a message into something you can click.
 *
 * Deliberately not a library. The job is one regex and one guard, and the guard is
 * the part that matters: an anchor built from user text is a place where `href` is
 * attacker-controlled, so the only two schemes that ever reach the DOM are `http:`
 * and `https:` — the pattern cannot match anything else, and a bare `www.` host is
 * given `https://` rather than being passed through as a relative path.
 *
 * `target="_blank"` needs `rel="noreferrer noopener"` beside it every time. Without
 * `noopener` the opened tab gets a handle on this one through `window.opener`, and a
 * link somebody DM'd you is exactly the link that would use it.
 */

/**
 * A URL inside a sentence.
 *
 * Two alternatives, scheme-first so `https://www.x.com` matches once as a whole
 * rather than twice. The character class is a blocklist rather than an allowlist of
 * URL-legal characters: brackets and quotes are excluded because a link is usually
 * pasted *inside* something — "(see https://x.com)" — and swallowing the closing
 * bracket into the href breaks the link and the sentence at once.
 */
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}]+/gi;

/**
 * Sentence punctuation that a URL can end on but almost never belongs to.
 *
 * "Look at https://x.com." is a link and a full stop, not a link to `x.com.` — and
 * the same goes for the comma in a list of three of them.
 */
const TRAILING = /[.,;:!?'"’”]+$/;

interface Part {
  text: string;
  href: string | null;
}

/**
 * Split a body into runs of plain text and runs that are links.
 *
 * Exported for the tests rather than for other callers: the splitting is the part
 * with edge cases in it, and it is much easier to assert on an array than on JSX.
 */
export function splitLinks(text: string): Part[] {
  const parts: Part[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    let found = match[0];

    // Punctuation peeled off the end goes back into the following text run, so the
    // sentence still reads correctly with the link inside it.
    const trailing = TRAILING.exec(found);
    let tail = "";
    if (trailing) {
      tail = trailing[0];
      found = found.slice(0, found.length - tail.length);
    }
    // A match that was *only* punctuation after the scheme is not a link at all.
    if (!found || found === "www." || /^https?:\/\/$/i.test(found)) continue;

    if (start > cursor) parts.push({ text: text.slice(cursor, start), href: null });
    parts.push({
      text: found,
      href: /^www\./i.test(found) ? `https://${found}` : found,
    });
    if (tail) parts.push({ text: tail, href: null });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), href: null });
  return parts;
}

/**
 * A message body with its links live.
 *
 * `break-all` on the anchors only, not on the paragraph: a long URL has no spaces to
 * wrap at and would otherwise push the bubble past its max width, while ordinary
 * words should still break between words like everywhere else in the app.
 */
export function Linkified({ text }: { text: string }) {
  const parts = splitLinks(text);

  return (
    <>
      {parts.map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all font-medium text-chat underline decoration-chat/40 underline-offset-2 transition-colors hover:decoration-chat"
          >
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
