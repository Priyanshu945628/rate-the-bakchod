import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOT_BOUNDS,
  BOT_DEFAULTS,
  BotCredentialsSchema,
  BotTuningSchema,
} from "@/lib/ai/bot-config";

/**
 * The bot's knobs, and the two things about them that can silently go wrong.
 *
 * The credential schema is the interesting half. It carries a three-way meaning per
 * field — absent leaves the stored value alone, an empty string shreds it back to the
 * environment, anything else replaces it — and each of the three does something
 * different and irreversible-ish, so the boundary between them is worth pinning down.
 *
 * The other half is drift: `BOT_DEFAULTS` claims to match the `@default` on every
 * column of `model BotSetting`, and nothing in the type system checks that. A row that
 * has never been written and a row written by the panel would then behave differently
 * on the same "default" setting.
 */

const tuning = (patch: Partial<Record<string, unknown>> = {}) => ({
  ...BOT_DEFAULTS,
  ...patch,
});

describe("BotTuningSchema", () => {
  it("accepts the defaults, so a fresh install is a valid setting", () => {
    expect(BotTuningSchema.safeParse(tuning()).success).toBe(true);
  });

  it("accepts both ends of every range", () => {
    for (const [key, { min, max }] of Object.entries(BOT_BOUNDS)) {
      expect(BotTuningSchema.safeParse(tuning({ [key]: min })).success).toBe(true);
      expect(BotTuningSchema.safeParse(tuning({ [key]: max })).success).toBe(true);
    }
  });

  it("rejects a value just outside every range", () => {
    for (const [key, { min, max }] of Object.entries(BOT_BOUNDS)) {
      expect(BotTuningSchema.safeParse(tuning({ [key]: min - 1 })).success).toBe(false);
      expect(BotTuningSchema.safeParse(tuning({ [key]: max + 1 })).success).toBe(false);
    }
  });

  it("rejects a fraction — these are all whole minutes or whole counts", () => {
    expect(BotTuningSchema.safeParse(tuning({ maxCommentsPerTick: 1.5 })).success).toBe(
      false,
    );
  });

  it("requires the switch, so a partial save cannot turn the bot on by omission", () => {
    const { enabled: _enabled, ...withoutSwitch } = tuning();
    expect(BotTuningSchema.safeParse(withoutSwitch).success).toBe(false);
  });

  it("lets zero switch a behaviour off", () => {
    // Documented behaviour, not an accident of the floors: no comments, no cards, no
    // delay are each a setting somebody may want.
    for (const key of ["commentDelayMinutes", "maxCommentsPerTick", "cardPercent"]) {
      expect(BotTuningSchema.safeParse(tuning({ [key]: 0 })).success).toBe(true);
    }
  });
});

describe("BotCredentialsSchema", () => {
  it("treats an absent field, an empty one and a value as three different things", () => {
    const absent = BotCredentialsSchema.parse({});
    expect(absent.apiKey).toBeUndefined();

    const cleared = BotCredentialsSchema.parse({ apiKey: "" });
    expect(cleared.apiKey).toBe("");

    const replaced = BotCredentialsSchema.parse({ apiKey: "sk-ant-example" });
    expect(replaced.apiKey).toBe("sk-ant-example");
  });

  it("trims, so a value pasted with a stray newline still clears or still saves", () => {
    expect(BotCredentialsSchema.parse({ apiKey: "  \n " }).apiKey).toBe("");
    expect(BotCredentialsSchema.parse({ baseUrl: " https://x.dev\n" }).baseUrl).toBe(
      "https://x.dev",
    );
  });

  it("rejects a key with whitespace inside it", () => {
    expect(BotCredentialsSchema.safeParse({ apiKey: "sk ant" }).success).toBe(false);
  });

  it("rejects a key longer than the column will take", () => {
    expect(BotCredentialsSchema.safeParse({ apiKey: "s".repeat(401) }).success).toBe(false);
  });

  it("requires a scheme on the base URL", () => {
    expect(BotCredentialsSchema.safeParse({ baseUrl: "tabitoken.com" }).success).toBe(
      false,
    );
    expect(BotCredentialsSchema.safeParse({ baseUrl: "https://tabitoken.com" }).success).toBe(
      true,
    );
    expect(BotCredentialsSchema.safeParse({ baseUrl: "http://localhost:8080" }).success).toBe(
      true,
    );
  });

  it("rejects a base URL ending in /v1, which the SDK would double", () => {
    for (const url of ["https://x.dev/v1", "https://x.dev/v1/"]) {
      expect(BotCredentialsSchema.safeParse({ baseUrl: url }).success).toBe(false);
    }
    // A path that merely contains it is fine — only the tail is the mistake.
    expect(BotCredentialsSchema.safeParse({ baseUrl: "https://x.dev/v1/proxy" }).success).toBe(
      true,
    );
  });

  it("accepts a model id and rejects one with a slash or a space", () => {
    expect(BotCredentialsSchema.safeParse({ model: "claude-opus-5" }).success).toBe(true);
    expect(BotCredentialsSchema.safeParse({ model: "vendor/model" }).success).toBe(false);
    expect(BotCredentialsSchema.safeParse({ model: "claude opus" }).success).toBe(false);
  });

  it("says something a person can act on when a paste goes wrong", () => {
    const result = BotCredentialsSchema.safeParse({ apiKey: "sk ant" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("whitespace");
    }
  });
});

describe("BOT_DEFAULTS", () => {
  /**
   * A row that has never been written falls back to `BOT_DEFAULTS` in code, while a row
   * the panel has written takes the column's `@default` for anything it did not set.
   * If the two disagree, "the default" means two different cadences.
   */
  it("matches every @default on model BotSetting", () => {
    const schema = readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );
    const model = /model BotSetting \{([\s\S]*?)\n\}/.exec(schema)?.[1];
    expect(model).toBeTruthy();

    for (const [key, expected] of Object.entries(BOT_DEFAULTS)) {
      const declared = new RegExp(`\\n\\s*${key}\\s+\\S+\\s+@default\\(([^)]+)\\)`).exec(
        model!,
      )?.[1];
      expect(declared, `${key} has no @default in the schema`).toBeTruthy();
      expect(declared, `${key} default`).toBe(String(expected));
    }
  });
});
