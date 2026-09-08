import "server-only";

/**
 * The other half of the failover chain: a gateway that speaks OpenAI's shape.
 *
 * A base URL points at a lot of things that are not Anthropic. Plenty of them forward
 * `/v1/messages` faithfully and the SDK handles those; plenty of others only ever serve
 * `/v1/chat/completions`, and against one of those every SDK call 404s on the path
 * before the model is even looked at. The bot answers a 404 the way it answers a rate
 * limit — with a canned Hinglish line — so the whole failure is invisible: a healthy
 * panel, a healthy log, and an account that has been reciting the same six lines since
 * the day the gateway was configured.
 *
 * This module is what `askForLine` tries once it has established that `/v1/messages` is
 * not there. Deliberately a bare `fetch`: one path, one header, no second SDK.
 *
 * Two rules, both inherited from the rest of `lib/ai`:
 *
 *  1. **Nothing here quotes the request.** No URL, no key, and no response body in an
 *     error — these are logged, and `lastError` is rendered in the admin panel. A
 *     gateway that echoes the request back on a 400 would otherwise put the key in the
 *     log with it. A status is the whole story a failure gets to tell.
 *  2. **A throw is the endpoint failing; a null is the model answering with nothing.**
 *     `acrossEndpoints` reads that difference — the first moves to the next gateway, the
 *     second stops the chain — so the two must not be blurred in here.
 */

import type Anthropic from "@anthropic-ai/sdk";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

/** The one path every OpenAI-compatible gateway serves. */
const CHAT_PATH = "/v1/chat/completions";

/**
 * Where a gateway with no base URL of its own would go.
 *
 * Only reachable by an endpoint that has already proved it has no `/v1/messages`, which
 * an unset base URL — api.anthropic.com — cannot do. It is here so the URL builder has
 * no undefined branch, not because anything is expected to arrive on it.
 */
const DEFAULT_BASE = "https://api.openai.com";

/**
 * Long enough for a slow proxy in front of a thinking model, short enough that one
 * unresponsive gateway cannot hold the whole tick. There is no retry here on purpose:
 * the chain of endpoints *is* the retry.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** A 200 whose body was not a completion. Synthetic — no gateway sends this. */
const NOT_A_COMPLETION = 502;

/**
 * A gateway that answered with a status instead of a message.
 *
 * `status` is the field `recordEndpointFailure` reads structurally, so a failure here
 * lands in the panel's health pill the same way an SDK error does.
 */
export class GatewayError extends Error {
  /** The HTTP status, or {@link NOT_A_COMPLETION} for a 200 that made no sense. */
  readonly status: number;

  constructor(status: number) {
    // No URL, no body, no key — rule 1.
    super(`OpenAI-shaped gateway answered ${status}`);
    this.name = "GatewayError";
    this.status = status;
  }
}

/** One entry of an OpenAI `content` array. */
interface Part {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

/**
 * Anthropic content blocks as OpenAI content parts.
 *
 * Only the two kinds this bot builds — text, and a base64 image — because those are the
 * only two it ever sends. Anything else is dropped rather than guessed at: a block this
 * file does not recognise is not worth a 400 from a gateway that would not have
 * recognised it either.
 */
export function toParts(content: readonly Block[]): Part[] {
  const parts: Part[] = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
      continue;
    }

    // A data URL is how the OpenAI shape carries an inline image, and the bytes are the
    // same base64 the Anthropic block was already holding — no re-encoding.
    if (block.type === "image" && block.source.type === "base64") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    }
  }

  return parts;
}

/** A `content` that is a string, a list of parts, or nothing usable. */
function flatten(content: unknown): string | null {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? // Some gateways answer with parts even when they were sent one string. Their
          // text is the reply; anything else in there (an image, a refusal object) is not.
          content
            .map((part) => (part as { text?: unknown } | null)?.text)
            .filter((value): value is string => typeof value === "string")
            .join(" ")
        : null;

  // Empty is the same as absent, whichever of the two shapes it arrived in: something
  // answered and there was nothing in it. Measured after trimming, because a reply of
  // one newline is not a line — but returned untrimmed, since cutting and trimming the
  // text is the caller's job on every other path too.
  return text !== null && text.trim().length > 0 ? text : null;
}

/**
 * The reply out of a completion body.
 *
 * Null means the model produced nothing — the gateway's own filter said no, or the
 * content came back empty. That is the same outcome as an Anthropic refusal and gets the
 * same treatment upstream.
 *
 * A body with no choice in it is a different thing entirely: the gateway answered 200
 * with something that is not a completion, which is an endpoint failing rather than a
 * model declining, so it throws and the next gateway gets its turn.
 */
export function readChoice(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  const choice = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
  if (!choice || typeof choice !== "object") throw new GatewayError(NOT_A_COMPLETION);

  const { finish_reason: reason, message } = choice as {
    finish_reason?: unknown;
    message?: { content?: unknown } | null;
  };

  if (reason === "content_filter") return null;
  return flatten(message?.content);
}

/** Everything one call needs — a subset of `BotCandidate`, so the chain passes its own. */
interface Gateway {
  apiKey: string;
  baseUrl: string | undefined;
  model: string;
}

/**
 * Ask an OpenAI-shaped gateway for one reply.
 *
 * The same prompt the plain Anthropic path sends: the persona as a system message, the
 * post's blocks, and a closing instruction where a schema would otherwise have been.
 * What comes back is raw text — the caller trims it, cuts it, and decides whether it is
 * a line or a poll, exactly as it does for `messages.create`.
 */
export async function askOpenAIShape(
  gateway: Gateway,
  system: string,
  content: readonly Block[],
  instruction: string,
): Promise<string | null> {
  const origin = (gateway.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");

  const res = await fetch(`${origin}${CHAT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Bearer, not `x-api-key`. Half the reason this file exists; the path is the other.
      authorization: `Bearer ${gateway.apiKey}`,
    },
    body: JSON.stringify({
      model: gateway.model,
      // No token cap. Newer models renamed `max_tokens` to `max_completion_tokens` and
      // gateways disagree about which they accept, so sending either is a 400 waiting to
      // happen on somebody's proxy — and it would surface as a silent canned post, which
      // is the failure this whole file exists to stop. What comes back is one line: the
      // persona says so, and the caller cuts it at 600 characters regardless.
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [...toParts(content), { type: "text", text: instruction }],
        },
      ],
    }),
    // Also opts the request out of Next's per-render fetch memoisation, which does not
    // reach a POST from a route handler in any case.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // The body is never read on a failure — rule 1.
  if (!res.ok) throw new GatewayError(res.status);

  // A 200 that is not JSON is the same class of problem as a 200 that is not a
  // completion, and deserves the same status rather than a bare SyntaxError.
  const payload = await res.json().catch(() => {
    throw new GatewayError(NOT_A_COMPLETION);
  });

  return readChoice(payload);
}
