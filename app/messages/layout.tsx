import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchConversations } from "@/lib/messages";
import { ConversationList } from "@/components/messages/conversation-list";
import { SplitPane } from "@/components/split-pane";

export const metadata: Metadata = {
  title: "Messages · Rate the Bakchod",
  robots: { index: false, follow: false },
};

/**
 * Two panes: the thread list, and whichever thread is open.
 *
 * This is a layout rather than part of each page so the list survives navigation
 * between threads — as a page it would remount on every click, refetch, and lose its
 * scroll position. `children` is `/messages` (the empty pane) or `/messages/[id]`.
 *
 * The height is pinned to the viewport because a conversation scrolls internally,
 * bottom-anchored. A thread that grew the document instead would fight the page
 * scroll every time a message arrived.
 *
 * The divider between them is draggable, and the width it lands on is remembered. The
 * bounds are the two ways the split stops being useful: under 240px a name and a
 * preview cannot both be read, and over 460px the thread starts losing the room its
 * bubbles need more.
 */
export default async function MessagesLayout({ children }: LayoutProps<"/messages">) {
  const user = await getCurrentUser();
  // Home, not a sign-in wall: a signed-out visitor has no inbox to be shown the
  // shape of.
  if (!user) redirect("/");

  const list = await fetchConversations(user.id);

  return (
    <SplitPane
      name="messages"
      initial={320}
      min={240}
      max={460}
      label="Conversation list width"
      className="mx-auto flex h-[calc(100dvh-8.5rem)] w-full max-w-[1100px] lg:h-[calc(100dvh-6rem)]"
      first={<ConversationList initial={list} viewerId={user.id} />}
      second={children}
    />
  );
}
