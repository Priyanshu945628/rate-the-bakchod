"use client";

import type { OwnerThemeSettings, PostKindName } from "@/lib/types";
import { Section } from "./fields";
import { PinIcon } from "../icons";

/**
 * The pinned post.
 *
 * Only your own visible, non-story posts are offered, and the server checks that
 * again on save — the picker narrowing the list is convenience, not enforcement.
 * Stories are excluded because a pin outlives them: pinning something that vanishes
 * in 24 hours would leave a hole at the top of your profile.
 */

export interface PinCandidate {
  id: string;
  kind: PostKindName;
  caption: string | null;
  thumbUrl: string | null;
  createdAt: string;
}

const when = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function PinnedSection({
  draft,
  onChange,
  candidates,
}: {
  draft: OwnerThemeSettings;
  onChange: (patch: Partial<OwnerThemeSettings>) => void;
  candidates: PinCandidate[];
}) {
  if (candidates.length === 0) {
    return (
      <Section title="Pinned post">
        <p className="text-[11px] text-faint">
          Post something first — then you can pin it to the top of your profile.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Pinned post">
      <ul className="space-y-1.5">
        {candidates.map((post) => {
          const pinned = draft.pinnedPostId === post.id;
          return (
            <li key={post.id}>
              <button
                type="button"
                // Clicking the pinned one unpins it, which is the only unpin
                // affordance anyone looks for.
                onClick={() => onChange({ pinnedPostId: pinned ? null : post.id })}
                aria-pressed={pinned}
                className={`flex w-full items-center gap-3 rounded-ctl border px-2.5 py-2 text-left transition-colors ${
                  pinned ? "border-ink" : "border-line hover:border-line-strong"
                }`}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-panel-2">
                  {post.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-[10px] font-medium text-faint">
                      {post.kind.toLowerCase()}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    {post.caption ?? <span className="text-faint">No caption</span>}
                  </span>
                  <span className="text-[11px] text-faint">
                    {when.format(new Date(post.createdAt))}
                  </span>
                </span>
                {pinned && <PinIcon className="h-4 w-4 shrink-0 text-ink" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
