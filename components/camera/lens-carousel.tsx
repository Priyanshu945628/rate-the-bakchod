"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SpinnerIcon, XIcon } from "../icons";
import { ORIGINAL, type Lens } from "@/lib/lenses/catalog";

/**
 * The dial: one round swatch per lens, the chosen one grown and ringed.
 *
 * Round art rather than a row of words, because a lens is a picture and a name is a poor
 * description of one — "Uncle" tells you nothing, a moustache tells you everything. Each
 * swatch carries what the lens is made of: a face lens shows its own drawing, a colour
 * preset shows a scrap of skin tone with the preset's filter on it, and the original is
 * an empty ring.
 *
 * `centre` is how the shutter ends up inside the dial rather than below it. Given one, the
 * lenses part around it and each half scrolls on its own, so whichever way the strip is
 * pushed there is a lens beside the button that uses it. Without one the dial is a single
 * strip, which is what the review screen wants — there is no shutter left to press there.
 *
 * Arrows step the selection rather than scrolling the strip. On a phone the strip is
 * swiped and they are hidden; with a mouse there is nothing to swipe, and a chevron that
 * moved a scrollbar instead of changing the lens would be the wrong control.
 */
export function LensCarousel({
  lenses,
  value,
  rendering,
  disabled,
  centre,
  onChange,
}: {
  lenses: Lens[];
  value: string;
  /** Id currently being drawn on the server, if any. */
  rendering: string | null;
  disabled?: boolean;
  /** Dropped into the middle of the strip, with the lenses pushed out around it. */
  centre?: ReactNode;
  onChange: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const index = Math.max(0, lenses.findIndex((lens) => lens.id === value));
  const selected = lenses[index];
  const split = centre ? Math.ceil(lenses.length / 2) : lenses.length;

  // Keep the chosen swatch in view however it was chosen — a tap, an arrow, or a lens
  // that was already selected when the strip changed shape between live and review.
  useEffect(() => {
    const node = row.current?.querySelector<HTMLElement>('[data-on="1"]');
    node?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value, lenses]);

  function step(by: number) {
    const next = lenses[index + by];
    if (next) onChange(next.id);
  }

  const swatches = (part: Lens[], hug: boolean) => (
    <Strip lenses={part} value={value} rendering={rendering} disabled={disabled} hug={hug} onChange={onChange} />
  );

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      {selected && selected.id !== ORIGINAL ? (
        <span className="rounded-pill bg-black/55 px-2 py-0.5 text-[10px] font-medium text-ink">
          {selected.label}
        </span>
      ) : null}

      <div ref={row} role="group" aria-label="Lenses" className="flex w-full items-center gap-1">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || index === 0}
          aria-label="Previous lens"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-pill text-muted transition-colors hover:text-ink disabled:opacity-25 md:flex"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        {swatches(lenses.slice(0, split), centre !== undefined)}
        {centre}
        {centre !== undefined && split < lenses.length ? swatches(lenses.slice(split), false) : null}

        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || index >= lenses.length - 1}
          aria-label="Next lens"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-pill text-muted transition-colors hover:text-ink disabled:opacity-25 md:flex"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * One scrollable run of swatches.
 *
 * `hug` reverses the flex direction so the run sits against its right edge and starts its
 * scroll there — the half to the left of the shutter has to crowd the shutter, and a
 * `justify-end` scroller is the one arrangement browsers still disagree about. Reversing
 * the list to match keeps the lenses in the order the dial declares them.
 */
function Strip({
  lenses,
  value,
  rendering,
  disabled,
  hug,
  onChange,
}: {
  lenses: Lens[];
  value: string;
  rendering: string | null;
  disabled?: boolean;
  hug: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <ul
      className={`no-bar flex min-w-0 flex-1 snap-x snap-mandatory items-center justify-start gap-2 overflow-x-auto py-1 ${
        hug ? "flex-row-reverse" : ""
      }`}
    >
      {(hug ? [...lenses].reverse() : lenses).map((lens) => {
        const on = lens.id === value;
        const busy = rendering === lens.id;
        return (
          <li key={lens.id} className="shrink-0 snap-center">
            <div className="relative">
              <button
                type="button"
                data-on={on ? "1" : "0"}
                onClick={() => onChange(lens.id)}
                disabled={disabled}
                aria-pressed={on}
                aria-label={lens.label}
                className={`flex items-center justify-center overflow-hidden rounded-full border transition-all disabled:opacity-50 ${
                  on
                    ? "h-[58px] w-[58px] border-accent ring-2 ring-accent/35"
                    : "h-11 w-11 border-line-strong opacity-80 hover:opacity-100"
                }`}
              >
                <Swatch lens={lens} />
                {busy ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <SpinnerIcon className="h-4 w-4 animate-spin text-ink" />
                  </span>
                ) : null}
              </button>

              {/* Clears back to the untouched picture. Its own button, outside the
                  swatch — a button inside a button is not a thing. */}
              {on && lens.id !== ORIGINAL ? (
                <button
                  type="button"
                  onClick={() => onChange(ORIGINAL)}
                  disabled={disabled}
                  aria-label="Clear lens"
                  className="absolute -right-0.5 -top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line-strong bg-panel-3 text-muted transition-colors hover:text-ink disabled:opacity-50"
                >
                  <XIcon className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What sits inside a swatch.
 *
 * A face lens shows its own art on a dark disc, which is why the drawings double as the
 * dial and no thumbnail has to be rendered per lens. A colour preset has no art at all,
 * so it gets a scrap of skin and sky with its own filter applied — a preview of the
 * change rather than a name for it. The original is left empty on purpose: an empty ring
 * reads as "off" in a way that any picture in there would not.
 */
function Swatch({ lens }: { lens: Lens }) {
  if (lens.kind === "face") {
    return (
      <span className="flex h-full w-full items-center justify-center bg-panel-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lens.swatch} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  if (lens.id === ORIGINAL) return <span className="h-full w-full bg-panel/60" />;
  return (
    <span
      style={{ filter: lens.css || undefined }}
      className="h-full w-full bg-[linear-gradient(150deg,#f3cba8_0%,#d99a6c_46%,#7c8ea6_100%)]"
    />
  );
}
