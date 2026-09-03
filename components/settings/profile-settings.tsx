"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DisplayNameSchema,
  HandleSchema,
  HEX_RE,
  isSafeLinkUrl,
  utf8Bytes,
} from "@/lib/profile-schema";
import { limits } from "@/lib/config";
import type { ClientHighlight, OwnerThemeSettings } from "@/lib/types";
import { IdentitySection, type IdentityDraft } from "./identity-section";
import { LookSection } from "./look-section";
import { WelcomeSection } from "./welcome-section";
import { PinnedSection, type PinCandidate } from "./pinned-section";
import { PrivacySection } from "./privacy-section";
import { HighlightsSection, type ArchiveItem } from "./highlights-section";
import { SpinnerIcon } from "../icons";

/**
 * The settings shell.
 *
 * One draft, one Save. Sections take `draft` and an `onChange(patch)` and never
 * fetch anything themselves — except the two that cannot work that way: images
 * upload on pick because they are their own rows, and highlights save per action
 * because they are their own rows too. Everything on `ProfileTheme` batches into a
 * single PATCH, so a half-saved profile is not a state you can land in.
 *
 * The client-side validation here duplicates `lib/profile-schema.ts` on purpose:
 * the same rules run on the server, and the ones here exist only to say what is
 * wrong before a round trip. The server is the one that decides.
 */

export function ProfileSettings({
  handle,
  displayName,
  initialTheme,
  initialHighlights,
  initialArchive,
  pinCandidates,
}: {
  handle: string;
  displayName: string;
  initialTheme: OwnerThemeSettings;
  initialHighlights: ClientHighlight[];
  initialArchive: ArchiveItem[];
  pinCandidates: PinCandidate[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialTheme);
  const [identity, setIdentity] = useState<IdentityDraft>({ displayName, handle });
  /** The handle the profile actually has right now, moved on a successful save. */
  const [savedHandle, setSavedHandle] = useState(handle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onChange(patch: Partial<OwnerThemeSettings>) {
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function onIdentityChange(patch: Partial<IdentityDraft>) {
    setSaved(false);
    setIdentity((current) => ({ ...current, ...patch }));
  }

  const problem = firstProblem(draft, identity);

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPatch(draft, identity, savedHandle)),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; identity?: IdentityDraft }
        | null;
      if (!res.ok) {
        throw new Error(body?.error ?? "Could not save that.");
      }
      const next = body?.identity ?? identity;
      setIdentity(next);
      setSaved(true);
      // A handle change moves the profile: the URL this page links to — and the
      // one the browser may already be sitting on — is now a redirect stub.
      if (next.handle !== savedHandle) {
        setSavedHandle(next.handle);
        router.replace(`/u/${encodeURIComponent(next.handle)}`);
        return;
      }
      // So the header on every other page picks up a new logo or accent.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <IdentitySection
        draft={draft}
        identity={identity}
        currentHandle={savedHandle}
        onChange={onChange}
        onIdentityChange={onIdentityChange}
      />
      <LookSection draft={draft} onChange={onChange} />
      <WelcomeSection
        draft={draft}
        onChange={onChange}
        handle={savedHandle}
        displayName={identity.displayName}
      />
      <PinnedSection draft={draft} onChange={onChange} candidates={pinCandidates} />
      <PrivacySection draft={draft} onChange={onChange} />
      <HighlightsSection
        initialHighlights={initialHighlights}
        initialArchive={initialArchive}
      />

      {/* Sticky, because this page is long enough that a footer button would be
          three scrolls away from whatever you just edited. */}
      <div className="sticky bottom-3 z-10">
        <div className="panel flex items-center gap-3 px-4 py-3 shadow-pop">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || problem !== null}
            className="flex h-9 items-center gap-2 rounded-ctl bg-accent px-4 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {saving && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save profile"}
          </button>
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : problem ? (
              <span className="text-danger">{problem}</span>
            ) : saved ? (
              <span className="text-muted">
                Saved.{" "}
                <a
                  href={`/u/${encodeURIComponent(savedHandle)}`}
                  className="text-ink underline decoration-line-strong"
                >
                  See your profile
                </a>
              </span>
            ) : (
              <span className="text-faint">
                Highlights and images save on their own. Everything else waits for this
                button.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The first thing the server would reject, in the order a reader would notice it. */
function firstProblem(draft: OwnerThemeSettings, identity: IdentityDraft): string | null {
  const name = DisplayNameSchema.safeParse(identity.displayName);
  if (!name.success) return name.error.issues[0]?.message ?? "That name will not do.";
  const handle = HandleSchema.safeParse(identity.handle);
  if (!handle.success) return handle.error.issues[0]?.message ?? "That handle will not do.";

  if (draft.accent !== null && draft.accent !== "" && !HEX_RE.test(draft.accent)) {
    return "That accent colour is not a hex value like #a89bd6.";
  }
  const badLink = draft.links.find(
    (link) => link.url.trim() !== "" && !isSafeLinkUrl(link.url.trim()),
  );
  if (badLink) return "Links have to be http or https addresses.";
  if (draft.links.some((link) => link.label.trim() === "" && link.url.trim() !== "")) {
    return "Give every link a label.";
  }
  const bytes = utf8Bytes(draft.welcomeHtml ?? "");
  if (bytes > limits.welcomeHtmlMaxBytes) {
    return `Your intro HTML is ${bytes - limits.welcomeHtmlMaxBytes} bytes over the limit.`;
  }
  if (draft.welcomeMs < 0 || draft.welcomeMs > limits.welcomeMaxMs) {
    return `Auto-dismiss has to be between 0 and ${limits.welcomeMaxMs} ms.`;
  }
  return null;
}

/**
 * Draft → PATCH body.
 *
 * `bannerUrl` / `logoUrl` are dropped: the patch schema has no keys for them, on
 * purpose — only the upload route may point a profile at an asset, so nobody can
 * PATCH their way to somebody else's image. Empty strings become `null` so that
 * clearing a field reads as "clear it" rather than "store a blank".
 *
 * `handle` is only sent when it actually moved. Sending the current one every
 * time would spend the 14-day cooldown on a save that changed a tagline.
 */
function toPatch(draft: OwnerThemeSettings, identity: IdentityDraft, savedHandle: string) {
  return {
    displayName: identity.displayName.trim(),
    ...(identity.handle !== savedHandle ? { handle: identity.handle } : {}),
    tagline: blank(draft.tagline),
    bio: blank(draft.bio),
    accent: blank(draft.accent),
    welcomeHtml: blank(draft.welcomeHtml),
    welcomeEnabled: draft.welcomeEnabled,
    welcomeMs: draft.welcomeMs,
    welcomePreset: draft.welcomePreset,
    links: draft.links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label !== "" && link.url !== ""),
    pinnedPostId: draft.pinnedPostId,
    visibility: draft.visibility,
    storiesVisibility: draft.storiesVisibility,
    showRatingsGiven: draft.showRatingsGiven,
    showJoinDate: draft.showJoinDate,
    allowComments: draft.allowComments,
  };
}

function blank(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
