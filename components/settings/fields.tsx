"use client";

import type { DmPolicyName, VisibilityName } from "@/lib/types";

/**
 * The small pieces every settings section is built from.
 *
 * Kept in one file because they are the shape of a form, not features: a section
 * shell, a labelled field, a switch, and the two-way visibility picker. Nothing here
 * validates — `lib/profile-schema.ts` does that, on both sides of the wire.
 */

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden shadow-card">
      <header className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-faint">{hint}</p>}
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

/** The one input style used everywhere, so a section never invents its own. */
export const inputClass =
  "mt-1.5 h-10 w-full rounded-ctl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint";

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      {/* A real checkbox, restyled — not a div pretending. Keyboard, screen readers
          and form semantics all come free that way. */}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{hint}</span>
        )}
      </span>
    </label>
  );
}

/**
 * A row of mutually exclusive options.
 *
 * Buttons with `aria-pressed` rather than a radio group: these apply to the draft the
 * moment they are pressed, and radios would promise a submit step that does not exist.
 */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1.5 flex gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`h-9 flex-1 rounded-ctl border px-1 text-xs font-medium transition-colors ${
              value === option.value
                ? "border-line-strong bg-panel-3 text-ink"
                : "border-line text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

const VISIBILITY_OPTIONS = [
  { value: "PUBLIC", label: "Anyone" },
  { value: "SIGNED_IN", label: "Signed in only" },
] as const satisfies readonly { value: VisibilityName; label: string }[];

export function VisibilityPicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: VisibilityName;
  onChange: (next: VisibilityName) => void;
}) {
  return (
    <Choice
      label={label}
      hint={hint}
      value={value}
      options={VISIBILITY_OPTIONS}
      onChange={onChange}
    />
  );
}

/**
 * `FOLLOWERS` is "people who follow me", not "people I follow" — it is the sender who
 * has to have followed. The labels say which way round it is because the two read
 * almost identically and mean opposite things.
 */
const DM_POLICY_OPTIONS = [
  { value: "EVERYONE", label: "Anyone" },
  { value: "FOLLOWERS", label: "My followers" },
  { value: "NOBODY", label: "No one" },
] as const satisfies readonly { value: DmPolicyName; label: string }[];

export function DmPolicyPicker({
  value,
  onChange,
}: {
  value: DmPolicyName;
  onChange: (next: DmPolicyName) => void;
}) {
  return (
    <Choice
      label="Who can message me"
      value={value}
      options={DM_POLICY_OPTIONS}
      onChange={onChange}
    />
  );
}
