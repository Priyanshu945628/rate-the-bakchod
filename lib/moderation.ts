import "server-only";

/**
 * Moderation reads. Writes go through `POST /api/admin`.
 *
 * The platform is transparent by design — nothing is screened on the way in — so
 * this is the whole moderation surface: what has been reported, and what an admin
 * did about it.
 */

import { prisma } from "./prisma";

export async function fetchOpenReports(take = 50) {
  return prisma.report.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      reporter: { select: { handle: true, displayName: true } },
      post: {
        select: {
          id: true,
          kind: true,
          caption: true,
          tweetText: true,
          storageKey: true,
          posterKey: true,
          isHidden: true,
          archiveState: true,
          wrappedKey: true,
          createdAt: true,
          author: { select: { handle: true, displayName: true, isAI: true } },
        },
      },
    },
  });
}

export interface AdminReportRow {
  id: string;
  reason: string;
  createdAt: string;
  reporterHandle: string;
  post: {
    id: string;
    kind: string;
    caption: string | null;
    tweetText: string | null;
    mediaUrl: string | null;
    isHidden: boolean;
    archiveState: string;
    /** False once the wrapped key is destroyed — the bytes are unreadable. */
    hasKey: boolean;
    authorHandle: string;
    createdAt: string;
  };
}

export async function fetchReportRows(take = 50): Promise<AdminReportRow[]> {
  const reports = await fetchOpenReports(take);

  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    reporterHandle: r.reporter.handle,
    post: {
      id: r.post.id,
      kind: r.post.kind,
      caption: r.post.caption,
      tweetText: r.post.tweetText,
      mediaUrl: r.post.storageKey
        ? `/api/media/${r.post.storageKey}${r.post.posterKey ? "?poster=1" : ""}`
        : null,
      isHidden: r.post.isHidden,
      archiveState: r.post.archiveState,
      hasKey: r.post.wrappedKey !== null,
      authorHandle: r.post.author.handle,
      createdAt: r.post.createdAt.toISOString(),
    },
  }));
}
