import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The rich rung's two ways of losing, told apart.
 *
 * A gateway can refuse the rich request with a status, or take it, drop the fields it
 * does not implement, and answer in prose. The first is visible; the second arrives as a
 * bare `AnthropicError` with no status on it, raised by the SDK's own parser rather than
 * by the wire — and until it was recognised it read as a dead endpoint, so the whole
 * chain was abandoned and a canned line posted by a gateway that had just answered 200.
 *
 * These assert the shape that predicate keys on, because it is matched on a message
 * string: if the SDK ever renames it, this is what says so.
 */

// Mirrors the predicate in lib/ai/bakchod.ts, which is not exported — the point here is
// the SDK's error shape, not the one-line function reading it.
function ignoredSchema(err: unknown): boolean {
  return (
    err instanceof Anthropic.AnthropicError &&
    !(err instanceof Anthropic.APIError) &&
    err.message.startsWith("Failed to parse structured output")
  );
}

describe("ignoredSchema", () => {
  it("recognises the SDK's structured-output parse failure", () => {
    // The message the SDK builds in lib/beta-parser.mjs when the reply is not JSON.
    const err = new Anthropic.AnthropicError(
      `Failed to parse structured output: Error: Failed to parse structured output as JSON: Unexpected token 'P', "Picnic pe "... is not valid JSON`,
    );
    expect(ignoredSchema(err)).toBe(true);
  });

  it("leaves a real HTTP failure to the status predicates", () => {
    // A 401 is a bad key, not a gateway with opinions about schemas. Absorbing it here
    // would retry a dead credential twice more and then post a canned line anyway.
    const err = new Anthropic.AuthenticationError(
      401,
      { type: "error" },
      "unauthorised",
      new Headers(),
    );
    expect(ignoredSchema(err)).toBe(false);
  });

  it("ignores an unrelated error", () => {
    expect(ignoredSchema(new Error("socket hang up"))).toBe(false);
    expect(ignoredSchema(new Anthropic.AnthropicError("something else"))).toBe(false);
    expect(ignoredSchema(null)).toBe(false);
  });

  it("still matches if the SDK appends detail after the prefix", () => {
    // Matched on the prefix rather than the whole string precisely because the tail is
    // the model's own prose, which is different on every call.
    expect(ignoredSchema(new Anthropic.AnthropicError("Failed to parse structured output: x"))).toBe(
      true,
    );
  });
});
