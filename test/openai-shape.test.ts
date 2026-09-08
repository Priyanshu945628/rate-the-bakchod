import { describe, expect, it } from "vitest";
import { GatewayError, readChoice, toParts } from "@/lib/ai/openai-shape";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The two ends of the OpenAI rung.
 *
 * Everything between them is one `fetch`, which is not worth a mock. What is worth
 * testing is the pair of translations either side of it, because both sit on the
 * boundary the rest of `lib/ai` was written not to cross: what goes out must not carry
 * a block the gateway will 400 over, and what comes back must land on the right side of
 * the null-versus-throw distinction that `acrossEndpoints` reads.
 *
 * Getting that distinction wrong is silent in both directions. A throw where null was
 * meant sends the same roast prompt down the chain until some gateway agrees to write
 * it; a null where a throw was meant retires a working fallback and posts a canned line.
 */

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

const text = (value: string): Block => ({ type: "text", text: value });

const image = (): Block => ({
  type: "image",
  source: { type: "base64", media_type: "image/webp", data: "AAAA" },
});

/** A body shaped the way a gateway that worked would shape it. */
const completion = (content: unknown, finish = "stop") => ({
  choices: [{ finish_reason: finish, message: { role: "assistant", content } }],
});

describe("toParts", () => {
  it("carries text through in order", () => {
    expect(toParts([text("first"), text("second")])).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  it("turns an inline image into the data URL the OpenAI shape expects", () => {
    // The same base64 the Anthropic block was holding, with the media type in front —
    // no decode, no re-encode, because the bytes were already in the right form.
    expect(toParts([image()])).toEqual([
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } },
    ]);
  });

  it("keeps the image and the text together, in the order they were built", () => {
    // `generateComment` puts the photo first and the brief after it, and a gateway that
    // reorders them describes the wrong thing.
    expect(toParts([image(), text("react to this")]).map((p) => p.type)).toEqual([
      "image_url",
      "text",
    ]);
  });

  it("drops a block it does not recognise rather than guessing", () => {
    // Not something this bot builds today. If it ever does, a 400 from a gateway that
    // would not have understood it either is the worse outcome of the two.
    const odd = { type: "thinking", thinking: "…", signature: "x" } as unknown as Block;
    expect(toParts([odd, text("keep me")])).toEqual([{ type: "text", text: "keep me" }]);
  });

  it("drops an image that is a reference rather than bytes", () => {
    const url = {
      type: "image",
      source: { type: "url", url: "https://example.test/a.png" },
    } as unknown as Block;
    expect(toParts([url])).toEqual([]);
  });
});

describe("readChoice", () => {
  it("reads the plain string case", () => {
    expect(readChoice(completion("Bhai yeh kya kar raha hai"))).toBe(
      "Bhai yeh kya kar raha hai",
    );
  });

  it("reads a content array, keeping only its text", () => {
    expect(
      readChoice(
        completion([
          { type: "text", text: "one" },
          { type: "image_url", image_url: { url: "…" } },
          { type: "text", text: "two" },
        ]),
      ),
    ).toBe("one two");
  });

  it("is null when the model produced nothing", () => {
    // Null is "the model answered, and the answer was nothing" — the chain stops here
    // and the caller posts a canned line. Not a reason to go shopping for a gateway
    // with worse judgement.
    expect(readChoice(completion(""))).toBeNull();
    expect(readChoice(completion("  \n "))).toBeNull();
    expect(readChoice(completion(null))).toBeNull();
    expect(readChoice(completion([]))).toBeNull();
    expect(readChoice(completion([{ type: "image_url", image_url: { url: "…" } }]))).toBeNull();
  });

  it("hands the text back untrimmed, the way every other path does", () => {
    // Nullness is decided on the trimmed length, but the trimming itself belongs to
    // `oneLine` and `stripMarker` upstream — this is extraction, not cleanup.
    expect(readChoice(completion("  padded  "))).toBe("  padded  ");
  });

  it("reads the gateway's own filter as the model declining", () => {
    // Same outcome as an Anthropic refusal, and for the same reason: something looked
    // at this prompt and said no. Sending it on to the next gateway would be shopping.
    expect(readChoice(completion("anything", "content_filter"))).toBeNull();
  });

  it("throws when a 200 was not a completion at all", () => {
    // The other side of the distinction: the gateway answered, but not with something
    // a model wrote. That is an endpoint failing, so the next one gets its turn.
    for (const body of [null, {}, { choices: null }, { choices: [] }, { choices: ["x"] }]) {
      expect(() => readChoice(body)).toThrow(GatewayError);
    }
  });

  it("carries a status a health row can record", () => {
    // `recordEndpointFailure` reads `status` structurally, so the panel shows a number
    // for this the same way it does for an SDK error.
    try {
      readChoice({ choices: [] });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).status).toBe(502);
    }
  });

  it("never puts anything from the request in its message", () => {
    // The rule the whole module is built on: these messages are logged, and `lastError`
    // is rendered in the admin panel. A status is all a failure gets to say.
    const err = new GatewayError(401);
    expect(err.message).toBe("OpenAI-shaped gateway answered 401");
    expect(err.name).toBe("GatewayError");
  });
});
