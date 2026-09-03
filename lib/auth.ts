import "server-only";

import { cache } from "react";
import { announceJoin } from "./notifications";
import { prisma } from "./prisma";
import { createClient } from "./supabase/server";
import type { User } from "@prisma/client";

/**
 * Bridges Supabase Auth identities to our own `User` rows.
 *
 * Supabase owns the credential; this table owns everything the platform cares
 * about — handle, score, whether the account is the AI. The row is created
 * lazily on first authenticated request rather than by a database trigger, so
 * all the logic stays in one readable place.
 */

interface Claims {
  sub?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Turn an email or display name into a usable @handle seed. */
function handleSeed(claims: Claims): string {
  const meta = claims.user_metadata ?? {};
  const raw =
    str(meta.preferred_username) ??
    str(claims.email)?.split("@")[0] ??
    str(meta.full_name) ??
    str(meta.name) ??
    "bakchod";

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  return cleaned.length >= 3 ? cleaned : `bakchod${cleaned}`;
}

/** Claim the seed, or the first free variant of it. */
async function allocateHandle(seed: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? seed : `${seed}${attempt + 1}`;
    const taken = await prisma.user.findUnique({
      where: { handle: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  // Fall back to something that cannot realistically collide.
  return `${seed}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `User` plus the one theme field that decides which picture is theirs.
 *
 * A superset of `User`, so everything that already takes a plain `User` keeps
 * accepting this. It is carried on the current user because the top bar draws
 * their avatar on every page, and a second query for one nullable string would be
 * a query on every page.
 */
export type CurrentUser = User & { theme: { logoKey: string | null } | null };

const withTheme = { theme: { select: { logoKey: true } } } as const;

/**
 * The signed-in user, or null. Cached per request so a page that checks auth in
 * several components still makes one query.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as Claims;
  const supabaseId = str(claims.sub);
  if (!supabaseId) return null;

  const existing = await prisma.user.findUnique({
    where: { supabaseId },
    include: withTheme,
  });
  if (existing) return existing;

  const meta = claims.user_metadata ?? {};
  const displayName =
    str(meta.full_name) ??
    str(meta.name) ??
    str(claims.email)?.split("@")[0] ??
    "Anonymous Bakchod";

  try {
    const created = await prisma.user.create({
      data: {
        supabaseId,
        handle: await allocateHandle(handleSeed(claims)),
        displayName: displayName.slice(0, 60),
        avatarUrl: str(meta.avatar_url) ?? str(meta.picture) ?? null,
      },
      include: withTheme,
    });
    // This is the only place an account comes into existence, so it is the only
    // honest place to announce one. Fire-and-forget: a first sign-in must not fail
    // because a bell could not be rung.
    void announceJoin(created);
    return created;
  } catch {
    // Two concurrent first requests can race to create the same identity; the
    // unique index settles it and the loser just reads the winner's row.
    return prisma.user.findUnique({ where: { supabaseId }, include: withTheme });
  }
});

export class UnauthorizedError extends Error {
  constructor() {
    super("You need to sign in to do that.");
    this.name = "UnauthorizedError";
  }
}

/** For write endpoints: the user, or a thrown 401. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
