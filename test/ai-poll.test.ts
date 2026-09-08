import { describe, expect, it } from "vitest";
import { __pollInternals } from "@/lib/ai/bakchod";
import { limits } from "@/lib/config";

/**
 * What the bot's polls are allowed to become.
 *
 * A poll is the one thing the bot writes whose *shape* the database has an opinion
 * about: `createPost` refuses fewer than `pollMinOptions` answers, so a sloppy reply
 * does not degrade into a worse poll, it costs the bot its slot and logs an error.
 * These two functions are the whole defence, and they run on the plain-text path where
 * there is no schema behind them at all — the reply is lines, and lines can be anything.
 *
 * `cleanPoll` clamps rather than complains on everything survivable and returns null
 * only for what is not a poll, because null is the signal the tick uses to post a line
 * instead. Both halves of that are load-bearing.
 */

const { cleanPoll, stripMarker } = __pollInternals;

const answers = (n: number) => Array.from({ length: n }, (_, i) => `answer ${i}`);

describe("stripMarker", () => {
  it("takes off the decorations a plain reply arrives with", () => {
    expect(stripMarker("- chai")).toBe("chai");
    expect(stripMarker("* chai")).toBe("chai");
    expect(stripMarker("• chai")).toBe("chai");
    expect(stripMarker("1. chai")).toBe("chai");
    expect(stripMarker("2) chai")).toBe("chai");
    expect(stripMarker("  10. chai  ")).toBe("chai");
  });

  it("leaves the answer's own punctuation alone", () => {
    // Only a leading marker goes. A dash inside the answer is part of it, and a
    // number that is the answer must survive being one.
    expect(stripMarker("chai - obviously")).toBe("chai - obviously");
    expect(stripMarker("100")).toBe("100");
    expect(stripMarker("3.5 hours")).toBe("3.5 hours");
    expect(stripMarker("...")).toBe("...");
  });
});

describe("cleanPoll", () => {
  it("takes a well-formed answer as it is", () => {
    expect(cleanPoll("Chai ya coffee?", ["Chai", "Coffee"])).toEqual({
      question: "Chai ya coffee?",
      options: ["Chai", "Coffee"],
    });
  });

  it("is null when there is no question", () => {
    expect(cleanPoll("", answers(3))).toBeNull();
    expect(cleanPoll("   ", answers(3))).toBeNull();
    expect(cleanPoll(null, answers(3))).toBeNull();
    expect(cleanPoll(42, answers(3))).toBeNull();
  });

  it("is null when there is nothing to press", () => {
    // The tick reads this null as "post a line instead", so it has to be the answer
    // for every case that is not a poll — including a model that wrote prose.
    expect(cleanPoll("Chai ya coffee?", [])).toBeNull();
    expect(cleanPoll("Chai ya coffee?", ["Chai"])).toBeNull();
    expect(cleanPoll("Chai ya coffee?", ["", "  "])).toBeNull();
    expect(cleanPoll("Chai ya coffee?", [1, null, {}])).toBeNull();
  });

  it("collapses repeated answers, which is what makes one of them null", () => {
    // Two spellings of one answer would split that answer's votes, so they become
    // one — and one answer is not a poll.
    expect(cleanPoll("Chai ya coffee?", ["Chai", "chai", "CHAI"])).toBeNull();
    expect(cleanPoll("Chai ya coffee?", ["Chai", " chai ", "Coffee"])).toEqual({
      question: "Chai ya coffee?",
      options: ["Chai", "Coffee"],
    });
  });

  it("clamps a long list instead of losing the slot over it", () => {
    const out = cleanPoll("Kaun?", answers(limits.pollMaxOptions + 4));
    expect(out?.options).toHaveLength(limits.pollMaxOptions);
    // The first ones, in order — not a sample, and not the tail.
    expect(out?.options).toEqual(answers(limits.pollMaxOptions));
  });

  it("cuts a long option rather than dropping it", () => {
    const long = "x".repeat(limits.pollOptionMaxLength + 50);
    const out = cleanPoll("Kaun?", [long, "short"]);
    expect(out?.options[0]).toHaveLength(limits.pollOptionMaxLength);
    expect(out?.options[1]).toBe("short");
  });

  it("cuts a long question to what a caption can hold", () => {
    // The question *is* the caption on a POLL post, so this is the same limit the
    // server would refuse it against.
    const out = cleanPoll("q".repeat(limits.captionMaxLength + 100), answers(2));
    expect(out?.question).toHaveLength(limits.captionMaxLength);
  });

  it("never hands back something createPost would refuse", () => {
    // The property that matters, over every shape a reply has taken here: whatever
    // survives is a poll the create path accepts.
    const shapes: [unknown, unknown[]][] = [
      ["Kaun?", answers(2)],
      ["Kaun?", answers(9)],
      ["Kaun?", ["a", "A", "b", "", "  b  ", 7, null]],
      ["  Kaun?  ", ["x".repeat(200), "y"]],
    ];

    for (const [question, options] of shapes) {
      const out = cleanPoll(question, options);
      if (!out) continue;
      expect(out.question.length).toBeGreaterThan(0);
      expect(out.question.length).toBeLessThanOrEqual(limits.captionMaxLength);
      expect(out.options.length).toBeGreaterThanOrEqual(limits.pollMinOptions);
      expect(out.options.length).toBeLessThanOrEqual(limits.pollMaxOptions);
      for (const option of out.options) {
        expect(option.length).toBeGreaterThan(0);
        expect(option.length).toBeLessThanOrEqual(limits.pollOptionMaxLength);
        expect(option).toBe(option.trim());
      }
      expect(new Set(out.options.map((o) => o.toLowerCase())).size).toBe(
        out.options.length,
      );
    }
  });
});
