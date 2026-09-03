"use client";

import { useRef, useState } from "react";
import { limits } from "@/lib/config";
import { HEX_RE, isSafeLinkUrl } from "@/lib/profile-schema";
import type { OwnerThemeSettings } from "@/lib/types";
import { Field, Section, inputClass } from "./fields";
import { PlusIcon, SpinnerIcon, TrashIcon } from "../icons";

/**
 * Banner, profile picture, accent colour and the link row.
 *
 * Images upload the moment they are picked, because they are not part of the theme
 * patch — they are rows in `ProfileAsset` with their own immutable URL, and the
 * patch only ever references the key the server chose. That also means an upload
 * survives navigating away without saving, which for a 300 KB banner is the right
 * trade.
 *
 * The picture is stored as `logoKey` and is the person's avatar everywhere — feed,
 * comments, leaderboard, stories — not just at the top of their profile.
 */

/**
 * A short palette for a *profile owner's* colour — a different thing from the
 * app's own accent, and the only place a user picks a colour at all. Every one is
 * desaturated on purpose: a saturated hue dropped onto a neutral near-black ground
 * is what makes a dark UI look cheap. Anyone who wants another shade can type the
 * hex.
 */
const SWATCHES = [
  "#f4f4f5",
  "#a1a1aa",
  "#7d8fb3",
  "#5f9ea0",
  "#7fae90",
  "#a89bd6",
  "#c47b74",
] as const;

type Slot = "BANNER" | "LOGO";

export function LookSection({
  draft,
  onChange,
}: {
  draft: OwnerThemeSettings;
  onChange: (patch: Partial<OwnerThemeSettings>) => void;
}) {
  const bannerInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const accent = draft.accent ?? "";
  const accentValid = accent === "" || HEX_RE.test(accent);
  const links = draft.links;

  async function upload(slot: Slot, file: File) {
    setUploading(slot);
    setAssetError(null);
    try {
      const form = new FormData();
      form.append("slot", slot);
      form.append("file", file);
      const res = await fetch("/api/profile-asset", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        asset?: { url: string };
        error?: string;
      } | null;
      if (!res.ok || !body?.asset) throw new Error(body?.error ?? "That did not upload.");
      onChange(slot === "BANNER" ? { bannerUrl: body.asset.url } : { logoUrl: body.asset.url });
    } catch (cause) {
      setAssetError(cause instanceof Error ? cause.message : "That did not upload.");
    } finally {
      setUploading(null);
    }
  }

  async function clear(slot: Slot) {
    setUploading(slot);
    setAssetError(null);
    try {
      const res = await fetch("/api/profile-asset", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not remove that.");
      }
      onChange(slot === "BANNER" ? { bannerUrl: null } : { logoUrl: null });
    } catch (cause) {
      setAssetError(cause instanceof Error ? cause.message : "Could not remove that.");
    } finally {
      setUploading(null);
    }
  }

  function setLink(index: number, patch: { label?: string; url?: string }) {
    onChange({
      links: links.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    });
  }

  return (
    <Section title="Look">
      <div>
        <p className="text-xs font-medium text-muted">Banner</p>
        <input
          ref={bannerInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload("BANNER", file);
            e.target.value = "";
          }}
        />
        {draft.bannerUrl ? (
          <div className="mt-1.5 overflow-hidden rounded-ctl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.bannerUrl}
              alt=""
              className="h-28 w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <p className="mt-1.5 flex h-28 items-center justify-center rounded-ctl border border-dashed border-line-strong text-[11px] text-faint">
            No banner yet
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <AssetButton
            onClick={() => bannerInput.current?.click()}
            busy={uploading === "BANNER"}
            label={draft.bannerUrl ? "Replace" : "Upload banner"}
          />
          {draft.bannerUrl && (
            <button
              type="button"
              onClick={() => void clear("BANNER")}
              disabled={uploading !== null}
              className="flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-danger disabled:opacity-50"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Profile picture</p>
        <input
          ref={logoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload("LOGO", file);
            e.target.value = "";
          }}
        />
        <div className="mt-1.5 flex items-center gap-3">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-panel-2">
            {draft.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.logoUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-[10px] text-faint">none</span>
            )}
          </span>
          <AssetButton
            onClick={() => logoInput.current?.click()}
            busy={uploading === "LOGO"}
            label={draft.logoUrl ? "Replace" : "Upload picture"}
          />
          {draft.logoUrl && (
            <button
              type="button"
              onClick={() => void clear("LOGO")}
              disabled={uploading !== null}
              className="flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-danger disabled:opacity-50"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      {assetError && <p className="text-xs text-danger">{assetError}</p>}

      <Field label="Accent colour" htmlFor="accent">
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onChange({ accent: hex })}
              aria-label={`Use ${hex}`}
              aria-pressed={accent.toLowerCase() === hex}
              className={`h-7 w-7 rounded-pill border-2 transition-colors ${
                accent.toLowerCase() === hex ? "border-ink" : "border-transparent"
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange({ accent: null })}
            className="h-7 rounded-pill border border-line px-2.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Default
          </button>
        </div>
        <input
          id="accent"
          value={accent}
          onChange={(e) => onChange({ accent: e.target.value })}
          placeholder="#a89bd6"
          maxLength={7}
          spellCheck={false}
          className={inputClass}
        />
        {!accentValid && (
          <p className="mt-1 text-[11px] text-danger">
            Six hex digits after a #, like #a89bd6.
          </p>
        )}
      </Field>

      <div>
        <p className="text-xs font-medium text-muted">
          Links ({links.length} / {limits.maxLinks})
        </p>
        <ul className="mt-1.5 space-y-2">
          {links.map((link, index) => {
            const urlOk = link.url.trim() === "" || isSafeLinkUrl(link.url.trim());
            return (
              <li key={index} className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <input
                    value={link.label}
                    onChange={(e) => setLink(index, { label: e.target.value })}
                    maxLength={limits.linkLabelMaxLength}
                    placeholder="Label"
                    aria-label={`Link ${index + 1} label`}
                    className="h-9 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
                  />
                  <input
                    value={link.url}
                    onChange={(e) => setLink(index, { url: e.target.value })}
                    maxLength={limits.linkUrlMaxLength}
                    placeholder="https://…"
                    inputMode="url"
                    spellCheck={false}
                    aria-label={`Link ${index + 1} address`}
                    className="h-9 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint"
                  />
                  {!urlOk && (
                    <p className="text-[11px] text-danger">
                      Only http and https addresses.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ links: links.filter((_, i) => i !== index) })
                  }
                  aria-label={`Remove link ${index + 1}`}
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line text-muted transition-colors hover:border-line-strong hover:text-danger"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        {links.length < limits.maxLinks && (
          <button
            type="button"
            onClick={() => onChange({ links: [...links, { label: "", url: "" }] })}
            className="mt-2 flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add a link
          </button>
        )}
      </div>
    </Section>
  );
}

function AssetButton({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-9 items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-50"
    >
      {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
      {busy ? "Uploading…" : label}
    </button>
  );
}
