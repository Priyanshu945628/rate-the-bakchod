/**
 * The mark.
 *
 * A dial: a half-circle scale with the needle swung high. It says *rate* without a
 * letter in it, which the old "RB" tile could not — two initials in a rounded box
 * is a placeholder, not a logo, and it read as one.
 *
 * Drawn on the same 24 grid as `icons.tsx`, and only a shade heavier (stroke 1.9
 * against 1.7): three shapes with a lot of air between them need the extra weight to
 * read as one object at 20px, but a full step heavier makes the logo the darkest
 * thing on the screen when it sits in a row of navigation at the same size. It is
 * monochrome by design — `currentColor` throughout, so it inherits `ink` in the
 * chrome and cannot become the one thing on the page spending the accent.
 */

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {/* The scale. Left to right over the top: sweep 1 is the clockwise half. */}
      <path d="M4.6 15.4a7.4 7.4 0 0 1 14.8 0" />
      {/* The needle, parked around 8 of 10 — this is a bakchod scoreboard. */}
      <path d="M12 15.4 16.3 10.4" />
      {/* Filled pivot: the one solid in the mark, so the centre reads as a hub
          rather than as the place two strokes happen to cross. */}
      <circle cx="12" cy="15.4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
