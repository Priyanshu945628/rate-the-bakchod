import "server-only";

import { Prisma, type User } from "@prisma/client";
import { prisma } from "./prisma";
import { limits } from "./config";

/**
 * Identity renaming: display name and handle.
 *
 * A handle is a public, permanent-looking URL. Changing it has three obligations
 * beyond "keep the column unique":
 *
 *  1. Every old link keeps working. `/u/<old>` must land on the person even when
 *     the handle is gone, so we record the released handle and redirect from it.
 *  2. Nobody else may squat a freed handle for a while. You rename, a stranger
 *     grabs your old name, and every link everyone ever shared now points at an
 *     impostor. The reservation window makes that only half true.
 *  3. You cannot thrash it. A handle that changes weekly is a churn vector, so a
 *     cooldown guards against ping-ponging.
 */

export class RenameError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RenameError";
    this.status = status;
  }
}

const RESERVATION_MS = limits.handleReservationDays * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = limits.handleCooldownDays * 24 * 60 * 60 * 1000;

export interface IdentityChange {
  displayName?: string;
  handle?: string;
}

/**
 * Apply a rename.
 *
 * The handle move, the cooldown stamp and the redirect stub go in one
 * transaction, so there is no instant where the handle has moved but `/u/<old>`
 * leads nowhere.
 *
 * `handle` is already validated (shape, length, reserved words) by `HandleSchema`
 * before this is called; this function owns the parts that need the database —
 * uniqueness, the reservation window and the person's own cooldown.
 */
export async function renameIdentity(user: User, change: IdentityChange): Promise<User> {
  const { displayName, handle } = change;
  const now = new Date();

  if (handle && handle !== user.handle) {
    if (user.handleChangedAt && now.getTime() - user.handleChangedAt.getTime() < COOLDOWN_MS) {
      const daysLeft = Math.ceil(
        (COOLDOWN_MS - (now.getTime() - user.handleChangedAt.getTime())) / (24 * 60 * 60 * 1000),
      );
      throw new RenameError(
        `You can change your @handle again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        429,
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        const owner = await tx.user.findUnique({
          where: { handle },
          select: { id: true },
        });
        if (owner && owner.id !== user.id) {
          throw new RenameError("That handle is taken.", 409);
        }

        // A handle someone else released is still theirs for the reservation
        // window. Without this, you rename and a stranger picks up your old name
        // an hour later — and every link anyone ever shared points at them.
        const reservation = await tx.handleHistory.findUnique({
          where: { handle },
          select: { userId: true, releasedAt: true },
        });
        if (
          reservation &&
          reservation.userId !== user.id &&
          now.getTime() - reservation.releasedAt.getTime() < RESERVATION_MS
        ) {
          throw new RenameError("That handle is taken.", 409);
        }
        // Taking the handle clears its stub, whether it was your own reservation
        // coming back or a stranger's that has lapsed. Otherwise the redirect
        // would fight the live handle for the same URL.
        if (reservation) {
          await tx.handleHistory.delete({ where: { handle } });
        }

        await tx.user.update({
          where: { id: user.id },
          data: { handle, handleChangedAt: now },
        });

        // Upsert, not create: `handle` is the primary key here, so a handle you
        // have released before already has a row, and renaming back and forth
        // would otherwise fail on the second lap.
        await tx.handleHistory.upsert({
          where: { handle: user.handle },
          create: { handle: user.handle, userId: user.id },
          update: { userId: user.id, releasedAt: now },
        });
      });
    } catch (cause) {
      if (cause instanceof RenameError) throw cause;
      // Two people racing for the same free handle: one transaction wins, the
      // other trips the unique index. That is a 409, not a 500.
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        throw new RenameError("That handle is taken.", 409);
      }
      throw cause;
    }
  }

  if (displayName && displayName !== user.displayName) {
    await prisma.user.update({ where: { id: user.id }, data: { displayName } });
  }

  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

/**
 * Called at the top of `/u/[handle]`: if the requested handle belongs to somebody
 * who used to own it, return the current one. `null` means "no history, render as
 * usual" — if the row is gone either way, the page 404s.
 */
export async function resolveHandleRedirect(handle: string): Promise<string | null> {
  const row = await prisma.handleHistory.findUnique({
    where: { handle },
    select: { user: { select: { handle: true } } },
  });
  return row?.user.handle ?? null;
}

/**
 * Backs the inline check in the settings form. `viewerId` matters: your own
 * current handle, and your own reservation from an earlier rename, both read as
 * available, because they are.
 */
export async function handleAvailable(
  handle: string,
  viewerId?: string | null,
): Promise<boolean> {
  const [owner, reservation] = await Promise.all([
    prisma.user.findUnique({ where: { handle }, select: { id: true } }),
    prisma.handleHistory.findUnique({
      where: { handle },
      select: { userId: true, releasedAt: true },
    }),
  ]);
  if (owner) return owner.id === viewerId;
  if (!reservation) return true;
  if (reservation.userId === viewerId) return true;
  return Date.now() - reservation.releasedAt.getTime() >= RESERVATION_MS;
}
