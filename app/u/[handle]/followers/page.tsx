import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchFollowList } from "@/lib/follows";
import { resolveHandleRedirect } from "@/lib/identity";
import { fetchProfile } from "@/lib/posts";
import { visibilityAllows } from "@/lib/profile";
import { PeopleList } from "@/components/people-list";
import { ChevronLeftIcon } from "@/components/icons";

/**
 * Who follows this person.
 *
 * Behind the same `SIGNED_IN` gate as the profile itself, and behind the same
 * rename redirect — a link to `/u/old-handle/followers` should land where the
 * profile link would.
 */

export async function generateMetadata(
  props: PageProps<"/u/[handle]/followers">,
): Promise<Metadata> {
  const { handle } = await props.params;
  const row = await fetchProfile(decodeURIComponent(handle));
  if (!row) return { title: "No such bakchod" };
  return {
    title: `Followers of ${row.displayName} (@${row.handle}) — Rate the Bakchod`,
    ...(row.theme?.visibility === "SIGNED_IN"
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}

export default async function FollowersPage(
  props: PageProps<"/u/[handle]/followers">,
) {
  const { handle } = await props.params;
  const asked = decodeURIComponent(handle);
  const row = await fetchProfile(asked);
  if (!row) {
    const current = await resolveHandleRedirect(asked);
    if (current) permanentRedirect(`/u/${encodeURIComponent(current)}/followers`);
    notFound();
  }

  const user = await getCurrentUser();
  const isSelf = user?.id === row.id;
  if (
    !isSelf &&
    !visibilityAllows(row.theme?.visibility ?? "PUBLIC", user?.id ?? null)
  ) {
    notFound();
  }

  const page = await fetchFollowList(row.handle, "followers", user?.id ?? null);

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3">
      <Link
        href={`/u/${row.handle}`}
        className="flex items-center gap-1.5 px-1 text-sm text-muted hover:text-ink"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        {row.displayName}
      </Link>

      <h1 className="px-1 text-lg font-bold text-ink">Followers</h1>

      <PeopleList
        initialPeople={page.people}
        initialCursor={page.nextCursor}
        mode="followers"
        handle={row.handle}
        empty={isSelf ? "Nobody follows you yet." : "No followers yet."}
      />
    </div>
  );
}
