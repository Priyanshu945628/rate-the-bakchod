import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchNotifications } from "@/lib/notifications";
import { NotificationPanel } from "@/components/notification-panel";

export const metadata: Metadata = {
  title: "Notifications · Rate the Bakchod",
  robots: { index: false, follow: false },
};

/**
 * The first page is fetched here rather than by the panel on mount, so arriving at
 * this route shows the list instead of a spinner that turns into the list.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  // Home, not a sign-in wall: a signed-out visitor has no bell to be shown the shape
  // of. Same rule as the inbox.
  if (!user) redirect("/");

  const page = await fetchNotifications(user.id);
  return <NotificationPanel initial={page} />;
}
