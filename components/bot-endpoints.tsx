"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EndpointCreateSchema, type EndpointStatus } from "@/lib/ai/bot-config";
import { inputClass, Section } from "./settings/fields";
import { ChevronLeftIcon, ChevronRightIcon, SpinnerIcon, TrashIcon } from "./icons";
import { TimeAgo } from "./time-ago";

/**
 * The bot's fallback chain: every gateway it will try, in the order it tries them.
 *
 * The write-only rule from the credentials section above applies here too, and shapes
 * the whole surface. A row is identified by the label whoever added it typed, and
 * everything else about it is a boolean or a health pill — no key, no base URL, no model
 * id, not even masked. That is also why there is no edit form: nothing here can show
 * which value is being replaced, so a box for one would either wipe a working credential
 * by being left empty or lie about what is in it. To change a key, delete the row and
 * add it again.
 *
 * Top of the list is tried first. The health pill is the part that earns its place —
 * with every value hidden, "which of these keys still works" is otherwise unanswerable
 * from this page, and a chain quietly running on its third entry looks exactly like one
 * running on its first.
 */

type Draft = { label: string; apiKey: string; baseUrl: string; model: string };

const EMPTY: Draft = { label: "", apiKey: "", baseUrl: "", model: "" };

export function BotEndpoints({ initial }: { initial: EndpointStatus[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState(EMPTY);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  /** Every mutation answers with the whole chain, so every one of them lands here. */
  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/bot/endpoints${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed: unknown = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(parsed)) {
        const said = parsed as { error?: string } | null;
        throw new Error(said?.error ?? "That did not go through.");
      }
      setRows(parsed as EndpointStatus[]);
      router.refresh();
      return true;
    } catch (cause) {
      setNote({
        text: cause instanceof Error ? cause.message : "That did not go through.",
        ok: false,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const parsed = EndpointCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setNote({ text: parsed.error.issues[0]?.message ?? "That will not do.", ok: false });
      return;
    }
    if (await send("", "POST", parsed.data)) {
      // The key box empties, like every other key box on this page.
      setDraft(EMPTY);
      setNote({ text: "Added.", ok: true });
    }
  }

  async function rename() {
    if (!renaming) return;
    if (await send(`/${renaming.id}`, "PATCH", { label: renaming.label })) {
      setRenaming(null);
    }
  }

  return (
    <Section title="Fallbacks">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className={`rounded-ctl border border-line px-3 py-2.5 ${
                row.enabled ? "" : "opacity-60"
              }`}
            >
              {renaming?.id === row.id ? (
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Name"
                    value={renaming.label}
                    onChange={(e) => setRenaming({ id: row.id, label: e.target.value })}
                    className={`${inputClass} mt-0`}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void rename()}
                    disabled={busy}
                    className="h-9 shrink-0 rounded-ctl bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    className="h-9 shrink-0 rounded-ctl border border-line px-3 text-xs font-medium text-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="mr-auto min-w-0 truncate text-sm font-medium text-ink">
                    {index + 1}. {row.label}
                  </span>
                  <Pill>{row.hasBaseUrl ? "own url" : "default url"}</Pill>
                  <Pill>{row.hasModel ? "own model" : "default model"}</Pill>
                  <Health row={row} />
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <RowButton
                  onClick={() =>
                    void send(`/${row.id}`, "PATCH", { enabled: !row.enabled })
                  }
                  disabled={busy}
                  pressed={row.enabled}
                  role="switch"
                >
                  {row.enabled ? "On" : "Off"}
                </RowButton>
                <RowButton
                  label="Move up"
                  onClick={() => void send(`/${row.id}`, "PATCH", { move: "up" })}
                  disabled={busy || index === 0}
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5 rotate-90" />
                </RowButton>
                <RowButton
                  label="Move down"
                  onClick={() => void send(`/${row.id}`, "PATCH", { move: "down" })}
                  disabled={busy || index === rows.length - 1}
                >
                  <ChevronRightIcon className="h-3.5 w-3.5 rotate-90" />
                </RowButton>
                <RowButton
                  onClick={() => setRenaming({ id: row.id, label: row.label })}
                  disabled={busy}
                >
                  Rename
                </RowButton>
                {/* Two presses. The key goes with the row, and nothing on this page
                    could tell you afterwards which one it was. */}
                <RowButton
                  label={confirming === row.id ? undefined : "Delete"}
                  onClick={() => {
                    if (confirming !== row.id) {
                      setConfirming(row.id);
                      return;
                    }
                    setConfirming(null);
                    void send(`/${row.id}`, "DELETE");
                  }}
                  disabled={busy}
                  pressed={confirming === row.id}
                >
                  {confirming === row.id ? "Delete for good" : <TrashIcon className="h-3.5 w-3.5" />}
                </RowButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <NewField
          id="endpoint-label"
          label="Name"
          placeholder="Which one is this"
          value={draft.label}
          onChange={(label) => setDraft({ ...draft, label })}
        />
        <NewField
          id="endpoint-key"
          label="API key"
          placeholder="Key"
          secret
          value={draft.apiKey}
          onChange={(apiKey) => setDraft({ ...draft, apiKey })}
        />
        <NewField
          id="endpoint-url"
          label="Base URL"
          placeholder="https://…"
          value={draft.baseUrl}
          onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
        />
        <NewField
          id="endpoint-model"
          label="Model"
          placeholder="Model id"
          value={draft.model}
          onChange={(model) => setDraft({ ...draft, model })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="flex h-9 items-center gap-2 rounded-ctl border border-line px-3 text-xs font-medium transition-colors hover:border-line-strong disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}
          Add fallback
        </button>
        {note && (
          <p className={`text-[11px] ${note.ok ? "text-muted" : "text-danger"}`}>{note.text}</p>
        )}
      </div>
    </Section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}

/**
 * Whether this gateway is answering, in the only two shapes that cannot carry a URL: a
 * status code, or the error's class name.
 *
 * Driven off `failures` rather than the timestamps, so a row that failed last week and
 * has worked ever since reads as working.
 */
function Health({ row }: { row: EndpointStatus }) {
  if (!row.hasKey) return <Bad>no key</Bad>;

  if (row.failures > 0) {
    const what = row.lastStatus ?? row.lastError ?? "failed";
    return (
      <Bad>
        {what}
        {row.failures > 1 && ` ×${row.failures}`}
      </Bad>
    );
  }

  if (row.lastOkAt) {
    return (
      <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        ok <TimeAgo iso={row.lastOkAt} />
      </span>
    );
  }

  return <Pill>untried</Pill>;
}

function Bad({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill bg-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
      {children}
    </span>
  );
}

/** One control in a row's strip. `label` is for the icon-only ones. */
function RowButton({
  children,
  label,
  onClick,
  disabled,
  pressed,
  role,
}: {
  children: React.ReactNode;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  role?: "switch";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      role={role}
      aria-checked={role === "switch" ? pressed : undefined}
      aria-pressed={role === "switch" ? undefined : pressed}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-ctl border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
        pressed
          ? "border-line-strong bg-panel-3 text-ink"
          : "border-line text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** A box on the add form. Empty on arrival and empty again after a save, like the rest. */
function NewField({
  id,
  label,
  placeholder,
  secret,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // `new-password` rather than `off`: browsers ignore `off` on a password box and
        // offer to save it anyway.
        autoComplete={secret ? "new-password" : "off"}
        autoCorrect="off"
        spellCheck={false}
        className={inputClass}
      />
    </div>
  );
}
