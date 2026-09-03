import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchThread } from "@/lib/messages";
import { Thread } from "@/components/messages/thread";

export const metadata: Metadata = {
  title: "Messages · Rate the Bakchod",
  robots: { index: false, follow: false },
};

/**
 * One open thread, server-rendered.
 *
 * A thread the viewer is not in is `notFound()`, the same as one that never existed.
 * A 403 here would tell whoever pasted the id that it is real.
 *
 * `Thread` is keyed by the conversation id: clicking from one thread to another
 * re-renders this component in place, and without the key React would keep the
 * previous conversation's messages in state under the new person's name.
 */
export default async function ThreadPage({ params }: PageProps<"/messages/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const thread = await fetchThread(user.id, id);
  if (!thread) notFound();

  return <Thread key={thread.id} initial={thread} viewerId={user.id} />;
}
