/**
 * Inline stroke icons. Kept local rather than pulling an icon package in — the
 * app needs a couple of dozen glyphs, all in one 24px stroke style, and a
 * dependency for that is not worth the bundle.
 *
 * Three rules hold every glyph together, and breaking one is what made the first
 * pass look hand-drawn:
 *
 *   1. **One box.** Everything is drawn inside 4→20 on the 24 grid, so no glyph
 *      sits visibly larger or smaller than its neighbours in the same slot.
 *   2. **Outlines close.** Where a shape has a silhouette — house, trophy, flame,
 *      flag — it is a single closed path, not a lid drawn near a box. Two paths
 *      that are meant to meet will not meet at 18px.
 *   3. **Round corners.** `strokeLinejoin: round` softens a join, it does not make
 *      a square a rounded rectangle. Panels, cards and screens are drawn with real
 *      corner arcs so they match `--radius-ctl` rather than fighting it.
 *
 * ## Sizes
 *
 * A glyph is sized by the job it does, not by the space that happens to be free,
 * and only these five steps exist:
 *
 * | class   | px | for                                                     |
 * |---------|----|---------------------------------------------------------|
 * | `h-3`   | 12 | sitting in a line of text — read ticks, counter marks   |
 * | `h-3.5` | 14 | a dense control, or a spinner in a panel header          |
 * | `h-4`   | 16 | **the default** — any control in a 28–36px tile          |
 * | `h-5`   | 20 | navigation, and controls in a 40px tile or larger        |
 * | `h-6`   | 24 | display — an empty state, or a control over full media   |
 *
 * The working rule behind the table is half the tile, rounded onto the ladder. An
 * arbitrary size — `h-[18px]`, `h-[22px]` — always looks like a mistake next to a
 * neighbour that took a step, because it is one.
 */

interface IconProps {
  className?: string;
}

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Roof and walls are one silhouette — drawn as two paths they kink at the eaves. */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M3.7 10.4 12 3.9l8.3 6.5v8.1a1.4 1.4 0 0 1-1.4 1.4H5.1a1.4 1.4 0 0 1-1.4-1.4v-8.1Z" />
      <path d="M9.7 19.9v-4.8a1.1 1.1 0 0 1 1.1-1.1h2.4a1.1 1.1 0 0 1 1.1 1.1v4.8" />
    </svg>
  );
}

/**
 * Curves only, no arcs. The previous flame was a dome on a saucer, which at 18px
 * read as a lightbulb; a flame needs a point at the top and its widest part low.
 */
export function FlameIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 3.2c-.5 2.6-1.9 4-3.2 5.3C7.3 9.9 6.3 11.4 6.3 13.4c0 3.6 2.6 6.3 5.7 6.3s5.7-2.7 5.7-6.3c0-2.2-1.1-3.7-2.6-5.2-1.4-1.4-2.6-2.7-3.1-5Z" />
      <path d="M12 18.6c-1.3 0-2.3-1-2.3-2.3 0-1.6 2.3-2.2 2.3-4.4 1.2 1.8 2.3 2.8 2.3 4.4 0 1.3-1 2.3-2.3 2.3Z" />
    </svg>
  );
}

/** Cup, two handles, stem, plinth — four parts that touch, none that overlap. */
export function TrophyIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M7.8 4.2h8.4v4.4a4.2 4.2 0 0 1-8.4 0V4.2Z" />
      <path d="M7.8 5.9H5.3v1.2a3.3 3.3 0 0 0 2.7 3.2" />
      <path d="M16.2 5.9h2.5v1.2a3.3 3.3 0 0 1-2.7 3.2" />
      <path d="M12 12.9v3.3" />
      <path d="M9.4 16.2h5.2l.8 3.6H8.6l.8-3.6Z" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 3.6 5.6 6.1v5.4c0 4 2.8 7.3 6.4 8.9 3.6-1.6 6.4-4.9 6.4-8.9V6.1L12 3.6Z" />
      <path d="m9.3 11.9 2 2 3.4-3.6" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m12 4 2.35 4.9 5.4.75-3.95 3.75.98 5.3L12 16.2l-4.78 2.5.98-5.3L4.25 9.65l5.4-.75L12 4Z" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M20 12c0 3.9-3.6 7-8 7-.9 0-1.8-.13-2.6-.37L5 20l1.1-3.1A6.6 6.6 0 0 1 4 12c0-3.9 3.6-7 8-7s8 3.1 8 7Z" />
    </svg>
  );
}

/** A flag that waves. The old pennant with a notch cut out of it read as a bookmark. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M6 4.4v15.4" />
      <path d="M6 5.6c3.6-1.6 6.6 1.6 10.2 0v7.2c-3.6 1.6-6.6-1.6-10.2 0V5.6Z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

/** The attach-an-image affordance: a photo, with the frame's corners actually round. */
export function ClipIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M5.6 5.4h12.8a1.6 1.6 0 0 1 1.6 1.6v10a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17V7a1.6 1.6 0 0 1 1.6-1.6Z" />
      <path d="M4 15.1 8.4 11l3 2.6 3.2-3 5.4 4.8" />
      <circle cx="9.1" cy="9.2" r="1.2" />
    </svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4.5 13.3 9l4.2 1.4-4.2 1.4L12 16.3l-1.3-4.5L6.5 10.4 10.7 9 12 4.5Z" />
      <path d="M18 16.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className} role="status">
      <path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5" opacity="0.85" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5.6 20c.7-3.5 3.3-5.6 6.4-5.6s5.7 2.1 6.4 5.6" />
    </svg>
  );
}

/**
 * A cog, not a sun. The teeth start *on* the ring rather than floating out past a
 * small hub — that gap is the whole difference between the two readings.
 */
export function GearIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2.3" />
      <path d="M12 6.5V4.4M12 17.5v2.1M17.5 12h2.1M4.4 12h2.1M15.9 8.1l1.5-1.5M6.6 17.4l1.5-1.5M15.9 15.9l1.5 1.5M6.6 6.6l1.5 1.5" />
    </svg>
  );
}

export function PaletteIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4a8 8 0 0 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.6 1-2.3 2.4-2.3H18a2.6 2.6 0 0 0 2-4.3A8 8 0 0 0 12 4Z" />
      <circle cx="8.6" cy="10" r="1" />
      <circle cx="12" cy="8.2" r="1" />
      <circle cx="15.4" cy="10" r="1" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M10 13.8a3.6 3.6 0 0 0 5.1 0l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1 1" />
      <path d="M14 10.2a3.6 3.6 0 0 0-5.1 0L6.5 12.6a3.6 3.6 0 0 0 5.1 5.1l1-1" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.1 4.2h5.8l-.8 4.6 2.9 2.9v1.1H7v-1.1l2.9-2.9-.8-4.6Z" />
      <path d="M12 12.8v7" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M6.6 10.4h10.8a1.4 1.4 0 0 1 1.4 1.4v6.4a1.4 1.4 0 0 1-1.4 1.4H6.6a1.4 1.4 0 0 1-1.4-1.4v-6.4a1.4 1.4 0 0 1 1.4-1.4Z" />
      <path d="M8.8 10.4V8.2a3.2 3.2 0 0 1 6.4 0v2.2" />
      <path d="M12 13.9v1.9" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M2.8 12S6.4 6.5 12 6.5 21.2 12 21.2 12 17.6 17.5 12 17.5 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M8.5 5.5 18 12l-9.5 6.5v-13Z" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.8 7h14.4M9.5 7V5.6a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7" />
      <path d="M6.7 7l.7 11.6a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3L17.3 7" />
      <path d="M10.4 10.5v5.4M13.6 10.5v5.4" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

/** The story-composer affordance: a camera, distinct from the plain image clip. */
export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.1 5.6h5.8l1.3 2.2h2.2a1.6 1.6 0 0 1 1.6 1.6v7.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 16.8V9.4a1.6 1.6 0 0 1 1.6-1.6h2.2l1.3-2.2Z" />
      <circle cx="12" cy="13.2" r="3.1" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9.4 5.5v13M14.6 5.5v13" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.6 9.6h2.8L11.3 6.2v11.6L7.4 14.4H4.6a.9.9 0 0 1-.9-.9v-3a.9.9 0 0 1 .9-.9Z" />
      <path d="M14.3 9.4a3.7 3.7 0 0 1 0 5.2" />
      <path d="M16.8 6.9a7.2 7.2 0 0 1 0 10.2" />
    </svg>
  );
}

/** Same cone, waves replaced by a cross — not a slash, which reads as "blocked". */
export function SpeakerOffIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.6 9.6h2.8L11.3 6.2v11.6L7.4 14.4H4.6a.9.9 0 0 1-.9-.9v-3a.9.9 0 0 1 .9-.9Z" />
      <path d="m14.6 9.9 4.6 4.4M19.2 9.9l-4.6 4.4" />
    </svg>
  );
}

/** Four corner brackets. Arrows would read as "move", not "fill the screen". */
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.6 9V5.8a1.2 1.2 0 0 1 1.2-1.2H9" />
      <path d="M15 4.6h3.2a1.2 1.2 0 0 1 1.2 1.2V9" />
      <path d="M19.4 15v3.2a1.2 1.2 0 0 1-1.2 1.2H15" />
      <path d="M9 19.4H5.8a1.2 1.2 0 0 1-1.2-1.2V15" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

/** One closed silhouette — a dome drawn near a base kinks at the shoulders. */
export function BellIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4.2a5.4 5.4 0 0 0-5.4 5.4c0 3.2-.7 4.7-1.5 5.7-.4.5 0 1.2.6 1.2h12.6c.6 0 1-.7.6-1.2-.8-1-1.5-2.5-1.5-5.7A5.4 5.4 0 0 0 12 4.2Z" />
      <path d="M10.2 19.1a2 2 0 0 0 3.6 0" />
    </svg>
  );
}

/** Two bubbles, not one: the rail's Messages differs from a post's Comments. */
export function MessageIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.6 18.4V9.6a2 2 0 0 1 2-2h7.2a2 2 0 0 1 2 2v3.8a2 2 0 0 1-2 2H8.4l-3.8 3Z" />
      <path d="M8.4 7.6V6.6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3.8a2 2 0 0 1-2 2h-1.6" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M19.6 4.4 4.5 10.6l6.1 2.8 2.8 6.1 6.2-15.1Z" />
      <path d="m10.6 13.4 9-9" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="10.8" cy="10.8" r="6" />
      <path d="m15.3 15.3 4.3 4.3" />
    </svg>
  );
}

export function UserPlusIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="10" cy="8.4" r="3.6" />
      <path d="M4 19.6c.6-3.3 3-5.4 6-5.4 1 0 1.9.2 2.7.6" />
      <path d="M16.4 14.4v5.2M13.8 17h5.2" />
    </svg>
  );
}

export function SmileIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0" />
      <circle cx="9.4" cy="10" r="0.9" />
      <circle cx="14.6" cy="10" r="0.9" />
    </svg>
  );
}

/** Sent. Paired with {@link DoubleCheckIcon} for read. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m5.2 12.6 4.2 4.2 9.4-10.8" />
    </svg>
  );
}

export function DoubleCheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="m4.4 12.6 3.2 3.2 6.6-7.6" />
      <path d="m10.4 15.8 1.2 1.2 7.6-8.8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M6.4 4.6h3l1.5 3.8-1.9 1.1a11.2 11.2 0 0 0 5.5 5.5l1.1-1.9 3.8 1.5v3a1.4 1.4 0 0 1-1.5 1.4C10.5 18.4 5.6 13.5 5 6.1a1.4 1.4 0 0 1 1.4-1.5Z" />
    </svg>
  );
}

/** The same handset, tipped over an arc. Universally "end call"; a slash is "muted". */
export function HangUpIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4.2 13.8a11.2 11.2 0 0 1 15.6 0l-1.8 1.8a1.3 1.3 0 0 1-1.8 0l-1-1a1.3 1.3 0 0 1-.4-1.2l.2-1a9.8 9.8 0 0 0-6 0l.2 1a1.3 1.3 0 0 1-.4 1.2l-1 1a1.3 1.3 0 0 1-1.8 0l-1.8-1.8Z" />
    </svg>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M5.6 7.6h7.2a1.6 1.6 0 0 1 1.6 1.6v5.6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 14.8V9.2a1.6 1.6 0 0 1 1.6-1.6Z" />
      <path d="M14.4 11.2 18.9 8.6a.7.7 0 0 1 1.1.6v5.6a.7.7 0 0 1-1.1.6l-4.5-2.6v-1.6Z" />
    </svg>
  );
}

export function CameraOffIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M5.6 7.6h7.2a1.6 1.6 0 0 1 1.6 1.6v5.6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 14.8V9.2a1.6 1.6 0 0 1 1.6-1.6Z" />
      <path d="M14.4 11.2 18.9 8.6a.7.7 0 0 1 1.1.6v5.6a.7.7 0 0 1-1.1.6l-4.5-2.6v-1.6Z" />
      <path d="m4.6 4.6 14.8 14.8" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4.4a2.4 2.4 0 0 1 2.4 2.4v4.6a2.4 2.4 0 0 1-4.8 0V6.8A2.4 2.4 0 0 1 12 4.4Z" />
      <path d="M6.9 11a5.1 5.1 0 0 0 10.2 0" />
      <path d="M12 16.1v3.5" />
    </svg>
  );
}

export function MicOffIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4.4a2.4 2.4 0 0 1 2.4 2.4v4.6a2.4 2.4 0 0 1-4.8 0V6.8A2.4 2.4 0 0 1 12 4.4Z" />
      <path d="M6.9 11a5.1 5.1 0 0 0 10.2 0" />
      <path d="M12 16.1v3.5" />
      <path d="m4.8 4.8 14.4 14.4" />
    </svg>
  );
}

/**
 * Front camera to back. A lens ringed by two arrows that turn the same way.
 *
 * Not the plain camera with a slash — that reads as "camera off", which is the
 * button sitting immediately next to this one.
 */
export function FlipCameraIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M6.6 7.4A7.2 7.2 0 0 1 19.2 10" />
      <path d="M19.2 6.2V10h-3.8" />
      <path d="M17.4 16.6A7.2 7.2 0 0 1 4.8 14" />
      <path d="M4.8 17.8V14h3.8" />
    </svg>
  );
}

/**
 * Install. An arrow coming down into a tray.
 *
 * The tray is a three-sided path rather than a rectangle with the top removed,
 * so the two upper ends stay square to the arrow instead of drifting apart at
 * 16px — rule 2 of the header, applied to an open shape.
 */
export function InstallIcon({ className }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 4.4v9.4" />
      <path d="m8.2 10.4 3.8 3.8 3.8-3.8" />
      <path d="M4.8 16.2v1.9a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5v-1.9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/**
 * The moderator badge: a tick inside a scalloped disc.
 *
 * Filled rather than stroked, and the only filled glyph in the set. That is
 * deliberate — a badge has to read as a *mark on* the name rather than another
 * control beside it, and at 14px a stroked scallop turns to mush. The tick is
 * punched out of the fill with the panel colour supplied by the caller, so the
 * badge takes the accent of whatever it is sitting on.
 */
export function VerifiedIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2.6l2.06 1.55 2.55-.36 1.03 2.37 2.37 1.03-.36 2.55L21.2 12l-1.55 2.06.36 2.55-2.37 1.03-1.03 2.37-2.55-.36L12 21.2l-2.06-1.55-2.55.36-1.03-2.37-2.37-1.03.36-2.55L2.8 12l1.55-2.06-.36-2.55 2.37-1.03L7.39 3.99l2.55.36L12 2.6Z" />
      <path
        d="m8.4 12.2 2.5 2.5 4.7-5.4"
        fill="none"
        stroke="var(--badge-ink, #0f1011)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
