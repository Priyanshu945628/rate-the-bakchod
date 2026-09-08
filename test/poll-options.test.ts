import { describe, expect, it } from "vitest";
import { cleanPollOptions } from "@/lib/posts";
import { limits } from "@/lib/config";

/**
 * What a poll's answers are allowed to be.
 *
 * This runs on two very different inputs and has to behave the same for both: a
 * person's composer, which submits a fixed number of boxes with some left blank, and
 * the bot, whose options arrive from a language model that was asked nicely. Neither
 * can be trusted to send a clean list, and the failure that matters is silent — two
 * options that differ only by case split one answer's votes, so the poll reports a
 * result that is wrong rather than merely untidy.
 *
 * The three-way return is the load-bearing part: null is "not a poll at all", which
 * is what lets `createPost` take the field absent, empty, or full of blanks without
 * any of them meaning three different things.
 */

const label = (n: number) => `option ${n}`;
const many = (n: number) => Array.from({ length: n }, (_, i) => label(i));

describe("cleanPollOptions", () => {
  it("reads absent, empty and all-blank as the same thing: not a poll", () => {
    expect(cleanPollOptions(null)).toBeNull();
    expect(cleanPollOptions(undefined)).toBeNull();
    expect(cleanPollOptions([])).toBeNull();
    expect(cleanPollOptions(["", "   ", "\n"])).toBeNull();
  });

  it("keeps the author's order", () => {
    // Never sorted, and never reordered by anything: the list a voter reads has to
    // be the list that was typed, or the buttons move under someone mid-vote.
    expect(cleanPollOptions(["zzz", "aaa", "mmm"])).toEqual(["zzz", "aaa", "mmm"]);
  });

  it("trims, and drops the blanks a composer leaves behind", () => {
    // The shape of a real submission: four boxes, two filled.
    expect(cleanPollOptions(["  chai  ", "", "coffee", "   "])).toEqual([
      "chai",
      "coffee",
    ]);
  });

  it("drops duplicates case-insensitively, keeping the first spelling", () => {
    expect(cleanPollOptions(["Chai", "chai", "CHAI", "coffee"])).toEqual([
      "Chai",
      "coffee",
    ]);
  });

  it("ignores anything that is not a string rather than crashing on it", () => {
    // Straight off `JSON.parse` of a hand-built request, so the array can hold
    // anything at all. A number is not an answer; it is also not a 500.
    expect(cleanPollOptions([1, "chai", null, { label: "x" }, "coffee", true])).toEqual([
      "chai",
      "coffee",
    ]);
  });

  it("refuses a poll with only one real answer", () => {
    // Not null: one filled box is somebody trying to make a poll and getting it
    // wrong, which deserves a message rather than silently becoming a text post.
    expect(() => cleanPollOptions(["chai", "", ""])).toThrow(
      new RegExp(`at least ${limits.pollMinOptions}`),
    );
    // Two spellings of one answer is one answer, so this collapses into the same case.
    expect(() => cleanPollOptions(["chai", "CHAI"])).toThrow(
      new RegExp(`at least ${limits.pollMinOptions}`),
    );
  });

  it("takes exactly the configured range", () => {
    expect(cleanPollOptions(many(limits.pollMinOptions))).toHaveLength(
      limits.pollMinOptions,
    );
    expect(cleanPollOptions(many(limits.pollMaxOptions))).toHaveLength(
      limits.pollMaxOptions,
    );
    expect(() => cleanPollOptions(many(limits.pollMaxOptions + 1))).toThrow(
      new RegExp(`at most ${limits.pollMaxOptions}`),
    );
  });

  it("measures a label after trimming it", () => {
    const longest = "x".repeat(limits.pollOptionMaxLength);
    expect(cleanPollOptions([`  ${longest}  `, "short"])).toEqual([longest, "short"]);
    expect(() => cleanPollOptions([`${longest}x`, "short"])).toThrow(
      new RegExp(`max ${limits.pollOptionMaxLength} characters`),
    );
  });

  it("leaves room for a poll worth voting on", () => {
    // A guard on the constants themselves. Two options is a real question; one
    // would make the vote a formality, and the label cap has to be long enough for
    // a Hinglish sentence rather than a single word.
    expect(limits.pollMinOptions).toBeGreaterThanOrEqual(2);
    expect(limits.pollMaxOptions).toBeGreaterThan(limits.pollMinOptions);
    expect(limits.pollOptionMaxLength).toBeGreaterThanOrEqual(40);
  });
});
