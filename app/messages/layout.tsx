import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchConversations } from "@/lib/messages";
import { ConversationList } from "@/components/messages/conversation-list";
import { KeyboardInset } from "@/components/keyboard-inset";
import { InboxSkeleton } from "@/components/messages/inbox-skeleton";

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
 * Full width, and a fixed list column. There used to be a draggable divider here; it
 * cost a visible grip in the middle of the screen and a stored width, to solve a
 * problem nobody has — a list of names needs the width a list of names needs, and the
 * thread should have the rest. Removing it also let the surface stop being 1100px in
 * the middle of a 1440px frame, which is what made the empty pane look like half a
 * page rather than a page.
 *
 * ## Why the list is behind `<Suspense>`
 *
 * `fetchConversations` is the slowest thing on the route — every thread, its
 * counterpart, and its last message. Awaited directly in this layout it would block
 * the whole navigation: Next renders a layout before anything under it, and a
 * `loading.tsx` cannot cover a layout's own data. So the segment would sit on the
 * previous page until the query came back, which is exactly the "changing pages takes
 * time" complaint.
 *
 * Behind a boundary, the frame and the thread arrive immediately and the list fills in.
 * `getCurrentUser` stays awaited out here on purpose — it is one cached lookup, and the
 * redirect below has to happen before anything renders rather than inside a fallback.
 */
export default async function MessagesLayout({ children }: LayoutProps<"/messages">) {
  const user = await getCurrentUser();
  // Home, not a sign-in wall: a signed-out visitor has no inbox to be shown the
  // shape of.
  if (!user) redirect("/");

  return (
    <>
      {/* Only mounted here. The keyboard is a problem for a pinned composer and
          nowhere else in the app. */}
      <KeyboardInset />
      <div className="chat-surface flex w-full gap-3">
        <Suspense fallback={<InboxSkeleton />}>
          <Inbox userId={user.id} />
        </Suspense>
        {children}
      </div>
    </>
  );
}

/** The awaited half, so the boundary above has something to suspend on. */
async function Inbox({ userId }: { userId: string }) {
  const list = await fetchConversations(userId);
  return <ConversationList initial={list} viewerId={userId} />;
}
