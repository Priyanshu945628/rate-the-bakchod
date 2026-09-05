"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BOT_BOUNDS,
  BotCredentialsSchema,
  type BotStatus,
  type BotTuning,
  type CredentialSource,
} from "@/lib/ai/bot-config";
import { Section, Toggle, inputClass } from "./settings/fields";
import { SpinnerIcon } from "./icons";
import { TimeAgo } from "./time-ago";

/**
 * The bot's panel.
 *
 * Two halves with different rules. The cadence half is an ordinary settings form:
 * current values in, edited values out. The credentials half is **write-only** — the
 * boxes start empty and go back to empty after every save, because the page is never
 * sent a key, a base URL or a model id to put in them. All it is told is which of the
 * three is configured and where it came from, which is the pill beside each box.
 *
 * That is also why "Run tick now" is here. With no value to read back, the way to
 * check a saved key is to make the bot use it.
 */

type CredKey = "apiKey" | "baseUrl" | "model";

/** A credential box: what has been typed, and whether it is set to be wiped. */
type CredDraft = { value: string; clear: boolean };

const EMPTY: CredDraft = { value: "", clear: false };
const EMPTY_CREDS: Record<CredKey, CredDraft> = {
  apiKey: EMPTY,
  baseUrl: EMPTY,
  model: EMPTY,
};

type TickReport = { commented: number; posted: boolean; skipped: boolean };

export function BotSettings({ initial }: { initial: BotStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [tuning, setTuning] = useState<BotTuning>(tuningOf(initial));
  const [creds, setCreds] = useState(EMPTY_CREDS);
  const [saving, setSaving] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  function onTuning(patch: Partial<BotTuning>) {
    setNote(null);
    setTuning((current) => ({ ...current, ...patch }));
  }

  function onCred(key: CredKey, draft: CredDraft) {
    setNote(null);
    setCreds((current) => ({ ...current, [key]: draft }));
  }

  const patch = buildPatch(tuning, creds);
  const problem = firstProblem(patch);
  const busy = saving || ticking;

  async function send(body: unknown, method: "PATCH" | "POST") {
    const res = await fetch("/api/admin/bot", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(parsed?.error ?? "That did not go through.");
    return parsed;
  }

  async function save() {
    if (problem) {
      setNote({ text: problem, ok: false });
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const next = (await send(patch, "PATCH")) as unknown as BotStatus;
      setStatus(next);
      setTuning(tuningOf(next));
      // Every box empties again. There is no state in which this page is holding a
      // credential it is not in the middle of sending.
      setCreds(EMPTY_CREDS);
      setNote({ text: "Saved.", ok: true });
      router.refresh();
    } catch (cause) {
      setNote({
        text: cause instanceof Error ? cause.message : "Could not save that.",
        ok: false,
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTick() {
    setTicking(true);
    setNote(null);
    try {
      const result = (await send(
        { action: "runTick" },
        "POST",
      )) as unknown as TickReport;
      setNote({ text: tickLabel(result), ok: true });
      router.refresh();
    } catch (cause) {
      setNote({
        text: cause instanceof Error ? cause.message : "The tick failed.",
        ok: false,
      });
    } finally {
      setTicking(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Cadence">
        <Toggle
          label="Bot enabled"
          checked={tuning.enabled}
          onChange={(enabled) => onTuning({ enabled })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="bot-comment-delay"
            label="Comment delay (minutes)"
            bound="commentDelayMinutes"
            value={tuning.commentDelayMinutes}
            onChange={(commentDelayMinutes) => onTuning({ commentDelayMinutes })}
          />
          <NumberField
            id="bot-max-comments"
            label="Comments per tick"
            bound="maxCommentsPerTick"
            value={tuning.maxCommentsPerTick}
            onChange={(maxCommentsPerTick) => onTuning({ maxCommentsPerTick })}
          />
          <NumberField
            id="bot-post-interval"
            label="Own posts, one every (minutes)"
            bound="postIntervalMinutes"
            value={tuning.postIntervalMinutes}
            onChange={(postIntervalMinutes) => onTuning({ postIntervalMinutes })}
          />
          <NumberField
            id="bot-card-percent"
            label="Cards (% of own posts)"
            bound="cardPercent"
            value={tuning.cardPercent}
            onChange={(cardPercent) => onTuning({ cardPercent })}
            pill={status.canRenderCards ? undefined : "no font"}
          />
        </div>
      </Section>

      <Section title="Credentials">
        <CredentialField
          id="bot-api-key"
          label="API key"
          placeholder="New key"
          secret
          source={status.apiKey}
          draft={creds.apiKey}
          onChange={(draft) => onCred("apiKey", draft)}
        />
        <CredentialField
          id="bot-base-url"
          label="Base URL"
          placeholder="https://…"
          source={status.baseUrl}
          draft={creds.baseUrl}
          onChange={(draft) => onCred("baseUrl", draft)}
        />
        <CredentialField
          id="bot-model"
          label="Model"
          placeholder="New model id"
          unsetLabel="default"
          source={status.model}
          draft={creds.model}
          onChange={(draft) => onCred("model", draft)}
        />
      </Section>

      <div className="sticky bottom-3 z-10">
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3 shadow-pop">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || problem !== null}
            className="flex h-9 items-center gap-2 rounded-ctl bg-accent px-4 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {saving && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => void runTick()}
            disabled={busy}
            className="flex h-9 items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium transition-colors hover:border-line-strong disabled:opacity-50"
          >
            {ticking && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
            {ticking ? "Running…" : "Run tick now"}
          </button>
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
            {problem ? (
              <span className="text-danger">{problem}</span>
            ) : note ? (
              <span className={note.ok ? "text-muted" : "text-danger"}>{note.text}</span>
            ) : (
              <Stamps status={status} />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

type BoundedKey = keyof typeof BOT_BOUNDS;

function NumberField({
  id,
  label,
  bound,
  value,
  onChange,
  pill,
}: {
  id: string;
  label: string;
  bound: BoundedKey;
  value: number;
  onChange: (next: number) => void;
  pill?: string;
}) {
  const { min, max } = BOT_BOUNDS[bound];
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        {pill && <Pill>{pill}</Pill>}
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Math.trunc(Number(e.target.value)) || 0)}
        className={inputClass}
      />
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}

/**
 * The two timestamps this page is allowed to show.
 *
 * `Never ticked` is the one that earns its place. Every credential here is write-only,
 * so "did the bot run on its own" cannot be answered by looking at the fields — and a
 * host with nothing scheduling the cron route is exactly the state where that reads
 * never and the only posts are the ones a button produced. It is also why this is a
 * timestamp and not a status line: a time cannot carry a key, a URL or a model id.
 *
 * A heartbeat stamp lands while nobody is watching, so this follows a page load rather
 * than updating live. "Run tick now" deliberately does not stamp it — the button forces
 * a pass without claiming one, so what shows here stays the automatic cadence.
 */
function Stamps({ status }: { status: BotStatus }) {
  return (
    <span className="text-faint">
      {status.updatedAt && (
        <>
          Saved <TimeAgo iso={status.updatedAt} /> ·{" "}
        </>
      )}
      {status.lastTickAt ? (
        <>
          Ticked <TimeAgo iso={status.lastTickAt} />
        </>
      ) : (
        "Never ticked"
      )}
    </span>
  );
}

const SOURCE_LABEL: Record<CredentialSource, string> = {
  database: "saved",
  environment: "environment",
  unset: "not set",
};

/**
 * One write-only credential.
 *
 * Empty on arrival and empty again after a save — nothing is ever prefilled, because
 * the server does not send a value to prefill it with. `Clear` is the third state the
 * API takes: it sends an empty string, which shreds the stored one and drops the bot
 * back to the environment variable.
 */
function CredentialField({
  id,
  label,
  placeholder,
  secret,
  unsetLabel,
  source,
  draft,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  unsetLabel?: string;
  source: CredentialSource;
  draft: CredDraft;
  onChange: (next: CredDraft) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        <Pill>{source === "unset" ? (unsetLabel ?? "not set") : SOURCE_LABEL[source]}</Pill>
      </div>
      <input
        id={id}
        type={secret ? "password" : "text"}
        value={draft.value}
        disabled={draft.clear}
        onChange={(e) => onChange({ value: e.target.value, clear: false })}
        placeholder={placeholder}
        // `new-password` rather than `off`: browsers ignore `off` on a password box
        // and offer to save it anyway.
        autoComplete={secret ? "new-password" : "off"}
        autoCorrect="off"
        spellCheck={false}
        className={`${inputClass} disabled:opacity-50`}
      />
      {source === "database" && (
        <button
          type="button"
          aria-pressed={draft.clear}
          onClick={() => onChange({ value: "", clear: !draft.clear })}
          className={`mt-1.5 h-8 rounded-ctl border px-2.5 text-[11px] font-medium transition-colors ${
            draft.clear
              ? "border-line-strong bg-panel-3 text-ink"
              : "border-line text-muted hover:border-line-strong hover:text-ink"
          }`}
        >
          {draft.clear ? "Clearing on save" : "Clear"}
        </button>
      )}
    </div>
  );
}

function tuningOf(status: BotStatus): BotTuning {
  return {
    enabled: status.enabled,
    commentDelayMinutes: status.commentDelayMinutes,
    maxCommentsPerTick: status.maxCommentsPerTick,
    postIntervalMinutes: status.postIntervalMinutes,
    cardPercent: status.cardPercent,
  };
}

/**
 * Draft → PATCH body.
 *
 * A credential is only in the body when it was touched, which is what makes the
 * absent/empty/value semantics work: an untouched box sends nothing at all, so saving
 * a cadence change cannot wipe a key by omission.
 */
function buildPatch(tuning: BotTuning, creds: Record<CredKey, CredDraft>) {
  const credentials = {
    apiKey: credValue(creds.apiKey),
    baseUrl: credValue(creds.baseUrl),
    model: credValue(creds.model),
  };
  const touched = Object.values(credentials).some((value) => value !== undefined);
  // `JSON.stringify` drops the undefined members, so an untouched field is absent on
  // the wire rather than null.
  return { tuning, ...(touched ? { credentials } : {}) };
}

function credValue(draft: CredDraft): string | undefined {
  if (draft.clear) return "";
  const trimmed = draft.value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const BOUND_LABEL: Record<BoundedKey, string> = {
  commentDelayMinutes: "Comment delay",
  maxCommentsPerTick: "Comments per tick",
  postIntervalMinutes: "Post interval",
  cardPercent: "Card share",
};

/**
 * The first thing the server would reject.
 *
 * The bounds are checked by hand rather than through `BotTuningSchema` because zod's
 * own wording for a range is not a sentence to put in front of somebody; the
 * credential messages are worth quoting, so those come from the schema.
 */
function firstProblem(patch: ReturnType<typeof buildPatch>): string | null {
  for (const key of Object.keys(BOT_BOUNDS) as BoundedKey[]) {
    const { min, max } = BOT_BOUNDS[key];
    const value = patch.tuning[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      return `${BOUND_LABEL[key]} has to be between ${min} and ${max}.`;
    }
  }

  if (patch.credentials) {
    const parsed = BotCredentialsSchema.safeParse(patch.credentials);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "That will not do.";
    }
  }

  return null;
}

function tickLabel({ commented, posted, skipped }: TickReport): string {
  if (skipped) return "Bot is off.";
  const comments = `${commented} ${commented === 1 ? "comment" : "comments"}`;
  return `${comments}, ${posted ? "1 post" : "no post"}.`;
}
