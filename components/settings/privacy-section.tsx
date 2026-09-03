"use client";

import type { OwnerThemeSettings } from "@/lib/types";
import { DmPolicyPicker, Section, Toggle, VisibilityPicker } from "./fields";

/**
 * Privacy.
 *
 * Every switch here is enforced on the server as well — the profile page, the posts
 * API and the comments route all read the same columns. Hiding something in the UI
 * only would be theatre, because anyone can call the API directly.
 *
 * There is no leaderboard opt-out, and that is on purpose: being rated in public is
 * the whole product, and an opt-out would let the biggest bakchods duck the ranking.
 * These controls cover the profile, stories, messages, comments and two secondary
 * stats.
 */
export function PrivacySection({
  draft,
  onChange,
}: {
  draft: OwnerThemeSettings;
  onChange: (patch: Partial<OwnerThemeSettings>) => void;
}) {
  return (
    <Section title="Privacy">
      <VisibilityPicker
        label="Who can see my profile"
        value={draft.visibility}
        onChange={(visibility) => onChange({ visibility })}
      />

      <VisibilityPicker
        label="Who can see my stories"
        value={draft.storiesVisibility}
        onChange={(storiesVisibility) => onChange({ storiesVisibility })}
      />

      <DmPolicyPicker
        value={draft.dmPolicy}
        onChange={(dmPolicy) => onChange({ dmPolicy })}
      />

      <Toggle
        label="Show how many ratings I've given"
        checked={draft.showRatingsGiven}
        onChange={(showRatingsGiven) => onChange({ showRatingsGiven })}
      />

      <Toggle
        label="Show when I joined"
        checked={draft.showJoinDate}
        onChange={(showJoinDate) => onChange({ showJoinDate })}
      />

      <Toggle
        label="Let people comment on my posts"
        checked={draft.allowComments}
        onChange={(allowComments) => onChange({ allowComments })}
      />
    </Section>
  );
}
