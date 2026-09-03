"use client";

import { useEffect, useRef, useState } from "react";
import { limits } from "@/lib/config";
import { utf8Bytes } from "@/lib/profile-schema";
import { WELCOME_PRESETS, renderPreset } from "@/lib/welcome-presets";
import { WELCOME_MIN_HEIGHT, WELCOME_SANDBOX, clampWelcomeHeight } from "@/lib/welcome-doc";
import type { OwnerThemeSettings } from "@/lib/types";
import { Field, Section, Toggle, inputClass } from "./fields";
import { EyeIcon, LockIcon } from "../icons";

/**
 * The welcome animation editor.
 *
 * Two things about the preview are deliberate and easy to get wrong later:
 *
 *   1. It is a real `<form method="post">` aimed at the frame by name, not a
 *      `fetch` whose result is handed over as `srcdoc` or a blob URL. A document
 *      given to a frame that way carries no headers, so it inherits *this page's*
 *      CSP — which would make the preview strictly more permissive than the real
 *      thing, and hide exactly the failures you want a preview to surface.
 *   2. The preview frame gets the same `sandbox` as the live one. Previewing your
 *      own HTML with more privilege than a visitor grants it would be a lie.
 */

const FRAME_NAME = "rtb-welcome-preview";

export function WelcomeSection({
  draft,
  onChange,
  handle,
  displayName,
}: {
  draft: OwnerThemeSettings;
  onChange: (patch: Partial<OwnerThemeSettings>) => void;
  handle: string;
  displayName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(WELCOME_MIN_HEIGHT);
  const [previewed, setPreviewed] = useState(false);

  const html = draft.welcomeHtml ?? "";
  const bytes = utf8Bytes(html);
  const overBudget = bytes > limits.welcomeHtmlMaxBytes;

  // The frame asks for a height the same way it does on a live profile, and gets it
  // clamped the same way. Nothing else it says is acted on here.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { __rtb?: unknown; px?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.__rtb === "height" && typeof data.px === "number") {
        setHeight(clampWelcomeHeight(data.px));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function preview() {
    setPreviewed(true);
    formRef.current?.requestSubmit();
  }

  return (
    <Section title="Welcome animation">
      <Toggle
        label="Play my intro to visitors"
        checked={draft.welcomeEnabled}
        onChange={(welcomeEnabled) => onChange({ welcomeEnabled })}
      />

      <div>
        <p className="text-xs font-medium text-muted">Start from a preset</p>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {WELCOME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onChange({
                  welcomeHtml: renderPreset(preset, displayName),
                  welcomePreset: preset.id,
                })
              }
              aria-pressed={draft.welcomePreset === preset.id}
              className={`rounded-ctl border px-3 py-2.5 text-left transition-colors ${
                draft.welcomePreset === preset.id
                  ? "border-ink"
                  : "border-line hover:border-line-strong"
              }`}
            >
              <span className="block text-xs font-semibold text-ink">{preset.label}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
                {preset.blurb}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Field
        label="HTML"
        htmlFor="welcome-html"
        hint={`${bytes} / ${limits.welcomeHtmlMaxBytes} bytes`}
      >
        <textarea
          id="welcome-html"
          value={html}
          onChange={(e) =>
            // Editing by hand means it is no longer that preset, whatever it started as.
            onChange({ welcomeHtml: e.target.value, welcomePreset: null })
          }
          rows={10}
          spellCheck={false}
          placeholder="<h1>Namaste</h1><script>setTimeout(rtbDone, 2000)</script>"
          className="mt-1.5 w-full resize-y rounded-ctl border border-line bg-panel-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink placeholder:text-faint"
        />
      </Field>

      {overBudget && (
        <p className="text-xs text-danger">
          That is {bytes - limits.welcomeHtmlMaxBytes} bytes over the limit — trim it
          before saving.
        </p>
      )}

      <Field
        label="Auto-dismiss"
        htmlFor="welcome-ms"
        hint="Milliseconds. 0 waits for the visitor."
      >
        <input
          id="welcome-ms"
          type="number"
          min={0}
          max={limits.welcomeMaxMs}
          step={500}
          value={draft.welcomeMs}
          onChange={(e) => onChange({ welcomeMs: Number(e.target.value) || 0 })}
          className={inputClass}
        />
      </Field>

      {/* Not an explainer panel: these two names are an API, and there is nowhere
          else in the product an author could look them up. Signatures only. */}
      <p className="flex items-center gap-2 text-[11px] text-faint">
        <LockIcon className="h-3.5 w-3.5 shrink-0" />
        Sandboxed. <code className="text-muted">rtbDone()</code> ends it,{" "}
        <code className="text-muted">rtbHeight(px)</code> resizes it.
      </p>

      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={preview}
            className="flex h-9 items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong"
          >
            <EyeIcon className="h-4 w-4" />
            {previewed ? "Preview again" : "Preview"}
          </button>
        </div>

        {/* Hidden, and submitted by hand: the values are already in React state, the
            form only exists so the POST response can land in the frame with its own
            headers. */}
        <form
          ref={formRef}
          method="post"
          action={`/api/welcome/${encodeURIComponent(handle)}?preview=1`}
          target={FRAME_NAME}
          className="hidden"
        >
          <input type="hidden" name="html" value={html} readOnly />
          <input type="hidden" name="accent" value={draft.accent ?? ""} readOnly />
        </form>

        <div className="mt-2 overflow-hidden rounded-ctl border border-line bg-black">
          <iframe
            ref={frameRef}
            name={FRAME_NAME}
            title="Intro preview"
            sandbox={WELCOME_SANDBOX}
            referrerPolicy="no-referrer"
            scrolling="no"
            className="block w-full border-0"
            style={{ height: previewed ? height : WELCOME_MIN_HEIGHT }}
          />
        </div>
      </div>
    </Section>
  );
}
