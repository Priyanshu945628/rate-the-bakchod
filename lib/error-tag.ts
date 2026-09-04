/**
 * A short, safe label for an error nobody expected.
 *
 * The generic 500 stays opaque on purpose — a stack trace or a driver message can
 * carry a file path, a query, or a connection string. But *"Something broke on our
 * side."* with nothing after it is also unreportable: on a deployed box the only
 * place the cause exists is the log, and the log is exactly what cannot be pasted
 * into a chat window.
 *
 * A class name (`PrismaClientKnownRequestError`) or an errno (`ENOSPC`, `EROFS`,
 * `P2022`) is neither. It names the failure without describing it, which is enough
 * to tell a full volume from a dropped connection from schema drift — from a
 * screenshot, with nothing redacted.
 *
 * Split out from `lib/api.ts` because that module reaches for Prisma, Supabase and
 * sharp, and this is a pure string function worth having tests for.
 */

/** Codes worth trusting: POSIX errnos and Prisma's `Pnnnn`. */
const CODE = /^(?:[A-Z][A-Z0-9]{1,14}|P\d{4})$/;

/** A plausible class name. Bounded, so a weird `name` cannot become the response. */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

/**
 * `null` when there is nothing safe and useful to say, so the caller can fall back
 * to the bare sentence rather than print an empty pair of brackets.
 */
export function errorTag(err: unknown): string | null {
  if (!(err instanceof Error)) return null;

  // `code` first: it is the specific half. Node puts the errno there, Prisma its
  // error code, and both are stable identifiers rather than prose.
  const code: unknown = (err as { code?: unknown }).code;
  if (typeof code === "string" && CODE.test(code)) return code;

  // An `AggregateError` from a connection attempt carries the real errno one level
  // down, and reports only "AggregateError" itself — which says nothing at all.
  const errors: unknown = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const inner of errors) {
      const tag = errorTag(inner);
      if (tag !== null && tag !== "Error") return tag;
    }
  }

  // `Error` is the default name and tells nobody anything; treat it as absent.
  return err.name !== "Error" && NAME.test(err.name) ? err.name : null;
}
