"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { DotsIcon } from "./icons";
import { useDismiss } from "./use-dismiss";

/**
 * The ⋯ menu. Shared by message bubbles and by a post's own author.
 *
 * Which way it opens is the one thing here that is not decoration. Both call sites
 * sit inside a scroll container, and a panel that overflows the *top* of a scroller is
 * not merely off-screen, it is unreachable: `scrollTop` cannot go negative. So the
 * direction is measured when the menu opens rather than decided by the call site,
 * which cannot know where its own row happens to be sitting.
 */

/** Roughly how tall the panel gets. Only ever used to pick a direction. */
const MENU_H = 150;

export interface MenuAction {
  /** What the item says, and its accessible name — there is no separate label. */
  label: string;
  icon: (props: { className?: string }) => ReactNode;
  run: () => void;
  /** Destructive. Drawn in red, and belongs last in the array. */
  danger?: boolean;
}

export function ActionMenu({
  label,
  actions,
  align = "end",
  size = "md",
  disabled = false,
}: {
  /** The trigger's accessible name. "Message options", "Post options". */
  label: string;
  /** An empty array renders nothing at all, trigger included. */
  actions: MenuAction[];
  /** Which edge of the trigger the panel hangs from. */
  align?: "start" | "end";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  useDismiss(
    open,
    wrap,
    useCallback(() => setOpen(false), []),
  );

  if (actions.length === 0) return null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const trigger = wrap.current?.getBoundingClientRect();
    // Whichever ancestor claims to clip us, or the viewport if none does.
    const bounds = wrap.current?.closest("[data-menu-bounds]")?.getBoundingClientRect();
    if (trigger) setUp(trigger.top - (bounds?.top ?? 0) > MENU_H);
    setOpen(true);
  }

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={`flex items-center justify-center rounded-ctl text-faint transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40 ${
          size === "sm" ? "h-6 w-6" : "h-8 w-8"
        }`}
      >
        <DotsIcon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>

      {open && (
        <div
          role="menu"
          className={`panel absolute z-30 min-w-[152px] overflow-hidden py-1 shadow-pop ${
            up ? "bottom-full mb-1" : "top-full mt-1"
          } ${align === "end" ? "right-0" : "left-0"}`}
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.run();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-panel-2 ${
                  action.danger ? "text-danger" : "text-muted hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
