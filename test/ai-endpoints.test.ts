import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EndpointCreateSchema,
  EndpointMoveSchema,
  EndpointPatchSchema,
  type EndpointStatus,
} from "@/lib/ai/bot-config";

/**
 * The bot's fallback chain, and the promises about it nothing else checks.
 *
 * Two matter more than the rest. A credential goes in and never comes back out, so
 * `EndpointStatus` carrying a field named after a value — or `listEndpointStatus`
 * building one — would undo the whole write-only panel in a single line. And a row's id
 * is its AAD, which is why the app generates it: an AAD has to exist before the
 * ciphertext it authenticates, so an `@default` on that column would quietly break the
 * order the sealing depends on.
 *
 * No database here, so the shape of the table is read out of `schema.prisma` the same way
 * `ai-bot-config.test.ts` reads its defaults.
 */

function read(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

const NEW_ROW = { label: "spare key", apiKey: "sk-ant-example" };

describe("EndpointCreateSchema", () => {
  it("takes a name and a key on their own — a second key on the same gateway", () => {
    const parsed = EndpointCreateSchema.parse(NEW_ROW);
    expect(parsed.baseUrl).toBeUndefined();
    expect(parsed.model).toBeUndefined();
  });

  it("insists on a key, unlike the settings form", () => {
    // A row with no key is skipped by the chain, so creating one would be adding a name
    // to a list and nothing else.
    expect(EndpointCreateSchema.safeParse({ label: "spare key" }).success).toBe(false);
    expect(EndpointCreateSchema.safeParse({ ...NEW_ROW, apiKey: "" }).success).toBe(false);
  });

  it("insists on a name, which is the only thing about a row the panel can show", () => {
    expect(EndpointCreateSchema.safeParse({ ...NEW_ROW, label: "  " }).success).toBe(false);
    const long = { ...NEW_ROW, label: "x".repeat(41) };
    expect(EndpointCreateSchema.safeParse(long).success).toBe(false);
  });

  it("trims the name, so a pasted one does not read oddly in the list", () => {
    expect(EndpointCreateSchema.parse({ ...NEW_ROW, label: " spare \n" }).label).toBe("spare");
  });

  it("rejects a key with whitespace in it", () => {
    expect(EndpointCreateSchema.safeParse({ ...NEW_ROW, apiKey: "sk ant" }).success).toBe(
      false,
    );
  });

  it("holds a fallback's base URL and model to the settings row's rules", () => {
    // The refinements are shared on purpose: a value typed into either half of the panel
    // deserves the same catch.
    const bad = [
      { baseUrl: "tabitoken.com" },
      { baseUrl: "https://x.dev/v1" },
      { model: "vendor/model" },
    ];
    for (const patch of bad) {
      expect(EndpointCreateSchema.safeParse({ ...NEW_ROW, ...patch }).success).toBe(false);
    }
    const good = { ...NEW_ROW, baseUrl: "https://x.dev", model: "claude-opus-5" };
    expect(EndpointCreateSchema.safeParse(good).success).toBe(true);
  });
});

describe("EndpointPatchSchema", () => {
  it("carries a name and a switch, and drops anything that looks like a credential", () => {
    const parsed = EndpointPatchSchema.parse({
      label: "renamed",
      enabled: false,
      apiKey: "sk-ant-example",
      baseUrl: "https://x.dev",
      model: "claude-opus-5",
    });
    // Nothing on this page can show which value is being replaced, so nothing on this
    // route may replace one. Changing a key is a delete and an add.
    expect(parsed).toEqual({ label: "renamed", enabled: false });
  });

  it("accepts a patch with neither field, which the route treats as a no-op", () => {
    expect(EndpointPatchSchema.parse({})).toEqual({});
  });

  it("will not blank a name", () => {
    expect(EndpointPatchSchema.safeParse({ label: " " }).success).toBe(false);
  });
});

describe("EndpointMoveSchema", () => {
  it("is up or down and nothing else", () => {
    expect(EndpointMoveSchema.safeParse({ move: "up" }).success).toBe(true);
    expect(EndpointMoveSchema.safeParse({ move: "down" }).success).toBe(true);
    expect(EndpointMoveSchema.safeParse({ move: "top" }).success).toBe(false);
  });
});

/** Values, or halves of one. None of these may name a field the panel is handed. */
type Credentialish = "apiKey" | "baseUrl" | "model" | "secretCipher" | "wrappedKey";

type NoCredentials = Extract<keyof EndpointStatus, Credentialish> extends never
  ? true
  : false;

describe("EndpointStatus", () => {
  it("has no field named after a value — which tsc settles as much as this does", () => {
    const noCredentials: NoCredentials = true;
    expect(noCredentials).toBe(true);
  });

  it("is built out of booleans and health, never out of a row's own values", () => {
    const source = read("lib", "ai", "endpoints.ts");
    const fn = /export async function listEndpointStatus[\s\S]*?\n\}/.exec(source)?.[0];
    expect(fn).toBeTruthy();
    // `hasBaseUrl:` and `hasModel:` are fine; a bare `baseUrl:` key would not be.
    for (const key of ["apiKey:", "baseUrl:", "model:", "secretCipher:"]) {
      expect(fn, `${key} is a value, and the panel is never sent one`).not.toContain(key);
    }
  });
});

describe("recordEndpointFailure", () => {
  it("stores the error's class name, never its message", () => {
    // An SDK error's message can quote the request URL, which is the one thing this
    // whole surface is built not to show.
    const source = read("lib", "ai", "endpoints.ts");
    const fn = /function classOf\([\s\S]*?\n\}/.exec(source)?.[0];
    expect(fn).toBeTruthy();
    expect(fn).not.toContain("message");
  });
});

describe("model BotEndpoint", () => {
  const model = /model BotEndpoint \{([\s\S]*?)\n\}/.exec(
    read("prisma", "schema.prisma"),
  )?.[1];

  it("exists, since the panel and the chain both read it", () => {
    expect(model).toBeTruthy();
  });

  it("leaves the id to the app, because the id is the row's AAD", () => {
    // A `@default` here would have the database mint the id at insert time, after the
    // key has already been sealed against something else.
    const declared = /\n\s*id\s+String\s+([^\n]*)/.exec(model!)?.[1] ?? "";
    expect(declared).toContain("@id");
    expect(declared).not.toContain("@default");
  });

  it("keeps all six envelope columns optional, so a row can carry no key", () => {
    const columns = [
      "secretCipher",
      "secretIv",
      "secretTag",
      "wrappedKey",
      "keyIv",
      "keyTag",
    ];
    for (const column of columns) {
      expect(model, column).toMatch(new RegExp(`\\n\\s*${column}\\s+Bytes\\?`));
    }
  });

  it("indexes priority, which every read of the chain orders by", () => {
    expect(model).toContain("@@index([priority])");
  });

  it("records a status and a class name, and has nowhere to put a message", () => {
    expect(model).toMatch(/\n\s*lastStatus\s+Int\?/);
    expect(model).toMatch(/\n\s*lastError\s+String\?/);
    expect(model).not.toMatch(/\n\s*lastMessage/);
  });
});
