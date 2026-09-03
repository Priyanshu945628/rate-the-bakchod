"use client";

import { useState } from "react";
import { limits } from "@/lib/config";
import { DisplayNameSchema, HandleSchema } from "@/lib/profile-schema";
import type { OwnerThemeSettings } from "@/lib/types";
import { Field, Section, inputClass } from "./fields";

/** The two fields that are on `User`, not on `ProfileTheme`. */
export interface IdentityDraft {
  displayName: string;
  handle: string;
}

type HandleState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "free" }
  | { kind: "taken" };

/**
 * Name, handle, tagline and bio.
 *
 * The handle is the one field here with consequences past this page — it is the
 * URL people have already shared. Changing it is allowed, and the server covers
 * what that breaks: `/u/<old>` 308-redirects to the new one, the old handle stays
 * reserved to you for {@link limits.handleReservationDays} days so nobody can pick
 * it up and inherit your links, and a change locks the field for
 * {@link limits.handleCooldownDays} days.
 *
 * Availability is checked on blur rather than on every keystroke: it is a lookup
 * against every account in the table, and one request per typed character is a
 * handle-enumeration endpoint with extra steps.
 */
export function IdentitySection({
  draft,
  identity,
  currentHandle,
  onChange,
  onIdentityChange,
}: {
  draft: OwnerThemeSettings;
  identity: IdentityDraft;
  currentHandle: string;
  onChange: (patch: Partial<OwnerThemeSettings>) => void;
  onIdentityChange: (patch: Partial<IdentityDraft>) => void;
}) {
  const [handleState, setHandleState] = useState<HandleState>({ kind: "idle" });

  const nameIssue = firstIssue(DisplayNameSchema.safeParse(identity.displayName));
  const handleIssue = firstIssue(HandleSchema.safeParse(identity.handle));
  const handleMoved = identity.handle !== currentHandle;

  function editHandle(raw: string) {
    // Shape the value as it is typed rather than rejecting it afterwards: the
    // field can only ever hold something the schema would accept.
    const next = raw
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, limits.handleMaxLength);
    setHandleState({ kind: "idle" });
    onIdentityChange({ handle: next });
  }

  async function checkHandle() {
    if (!handleMoved || handleIssue) return;
    setHandleState({ kind: "checking" });
    try {
      const res = await fetch(
        `/api/profile/handle-available?handle=${encodeURIComponent(identity.handle)}`,
      );
      const body = (await res.json().catch(() => null)) as { available?: boolean } | null;
      setHandleState({ kind: body?.available ? "free" : "taken" });
    } catch {
      setHandleState({ kind: "idle" });
    }
  }

  return (
    <Section title="About you">
      <Field label="Name" htmlFor="displayName" hint={nameIssue ?? undefined}>
        <input
          id="displayName"
          value={identity.displayName}
          onChange={(e) => onIdentityChange({ displayName: e.target.value })}
          maxLength={limits.displayNameMaxLength}
          placeholder="What people call you"
          className={inputClass}
        />
      </Field>

      <Field label="Handle" htmlFor="handle" hint={handleHint(handleIssue, handleState, handleMoved)}>
        <div
          className={`mt-1.5 flex h-10 items-center rounded-ctl border bg-panel-2 pl-3 ${
            handleIssue || handleState.kind === "taken" ? "border-danger" : "border-line"
          }`}
        >
          <span className="text-sm text-faint">@</span>
          <input
            id="handle"
            value={identity.handle}
            onChange={(e) => editHandle(e.target.value)}
            onBlur={() => void checkHandle()}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-faint"
          />
        </div>
      </Field>

      <Field
        label="Tagline"
        htmlFor="tagline"
        hint={`${(draft.tagline ?? "").length} / ${limits.taglineMaxLength}`}
      >
        <input
          id="tagline"
          value={draft.tagline ?? ""}
          onChange={(e) => onChange({ tagline: e.target.value })}
          maxLength={limits.taglineMaxLength}
          placeholder="Certified bakchod, allegedly"
          className={inputClass}
        />
      </Field>

      <Field
        label="Bio"
        htmlFor="bio"
        hint={`${(draft.bio ?? "").length} / ${limits.bioMaxLength}`}
      >
        <textarea
          id="bio"
          value={draft.bio ?? ""}
          onChange={(e) => onChange({ bio: e.target.value })}
          maxLength={limits.bioMaxLength}
          rows={4}
          placeholder="Whatever people should know before they rate you."
          className="mt-1.5 w-full resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-faint"
        />
      </Field>
    </Section>
  );
}

function handleHint(
  issue: string | null,
  state: HandleState,
  moved: boolean,
): string | undefined {
  if (issue) return issue;
  if (!moved) return undefined;
  if (state.kind === "checking") return "Checking…";
  if (state.kind === "taken") return "That handle is taken.";
  if (state.kind === "free") return `Free. Locked for ${limits.handleCooldownDays} days after saving.`;
  return undefined;
}

/** The message the server would give for this value, or null if it is fine. */
function firstIssue(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}): string | null {
  if (result.success) return null;
  return result.error?.issues[0]?.message ?? "That will not do.";
}
