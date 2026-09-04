import "server-only";

/**
 * Shared plumbing for route handlers: one place that turns a thrown domain
 * error into the right status code, so handlers stay readable and no endpoint
 * accidentally leaks a stack trace to the client.
 */

import { NextResponse } from "next/server";
import { UnauthorizedError, requireUser } from "./auth";
import { PostServiceError } from "./posts";
import { MediaError } from "./media/pipeline";
import { errorTag } from "./error-tag";
import { consumeRateLimit } from "./ratelimit";
import type { RateLimitBucket } from "./config";
import type { User } from "@prisma/client";

export function jsonError(message: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers: extra });
}

export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  if (err instanceof PostServiceError) return jsonError(err.message, err.status);
  if (err instanceof MediaError) return jsonError(err.message, 415);

  // Anything unrecognised is a bug. Log it in full, and tell the client only what
  // kind of bug it was: on a deployed box the log is the one place the cause exists,
  // and a log line can carry a connection string, so the code has to travel in the
  // response instead. `errorTag` is the part that is safe to show.
  console.error("[api] unhandled error:", err);
  const tag = errorTag(err);
  return jsonError(
    tag ? `Something broke on our side. (${tag})` : "Something broke on our side.",
    500,
  );
}

/**
 * Authenticate and spend one unit of the given rate-limit bucket.
 * Returns either the user or the response to send back.
 */
export async function authorizeWrite(
  bucket: RateLimitBucket,
): Promise<{ user: User } | { response: NextResponse }> {
  let user: User;
  try {
    user = await requireUser();
  } catch (err) {
    return { response: handleRouteError(err) };
  }

  const limit = await consumeRateLimit(user.id, bucket);
  if (!limit.ok) {
    return {
      response: jsonError("Slow down a bit — you have hit the limit.", 429, {
        "retry-after": String(limit.retryAfterSec),
      }),
    };
  }

  return { user };
}

/**
 * Parse a JSON body, turning a malformed one into a 400 rather than a 500.
 * `request.json()` throws a `SyntaxError`, which `handleRouteError` would
 * otherwise treat as a bug on our side.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PostServiceError("Expected a JSON body.", 400);
  }
}
