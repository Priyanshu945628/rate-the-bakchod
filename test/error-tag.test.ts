import { describe, expect, it } from "vitest";
import { errorTag } from "@/lib/error-tag";

/** What Node throws when a volume is full, shaped the way `fs` shapes it. */
function systemError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe("errorTag", () => {
  it("prefers an errno, which is the half that names the cause", () => {
    expect(errorTag(systemError("ENOSPC", "ENOSPC: no space left on device, write"))).toBe(
      "ENOSPC",
    );
    expect(errorTag(systemError("EROFS", "EROFS: read-only file system, mkdir '/data'"))).toBe(
      "EROFS",
    );
  });

  it("keeps a Prisma error code", () => {
    const err = new Error("The column `Post.x` does not exist") as Error & { code: string };
    err.code = "P2022";
    expect(errorTag(err)).toBe("P2022");
  });

  it("falls back to the class name when there is no code", () => {
    class PrismaClientInitializationError extends Error {
      override name = "PrismaClientInitializationError";
    }
    expect(errorTag(new PrismaClientInitializationError("nope"))).toBe(
      "PrismaClientInitializationError",
    );
    expect(errorTag(new SyntaxError("Unexpected end of JSON input"))).toBe("SyntaxError");
  });

  it("digs the errno out of an AggregateError, which names nothing by itself", () => {
    const inner = systemError("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.1:6543");
    expect(errorTag(new AggregateError([inner], "all attempts failed"))).toBe("ECONNREFUSED");
  });

  it("says nothing rather than something useless", () => {
    // A bare Error's name is "Error", which would print an empty pair of brackets.
    expect(errorTag(new Error("boom"))).toBeNull();
    expect(errorTag("a string")).toBeNull();
    expect(errorTag(null)).toBeNull();
  });

  it("never lets a message reach the response", () => {
    // The whole point: a driver error's text can carry a connection string, so only
    // an identifier is allowed through — never anything free-form.
    const leaky = new Error(
      'postgresql://postgres.abc:hunter2@aws-0-ap-south-1.pooler.supabase.com:6543',
    ) as Error & { code: string };
    leaky.code = "postgresql://postgres.abc:hunter2@host";
    expect(errorTag(leaky)).toBeNull();
  });
});
