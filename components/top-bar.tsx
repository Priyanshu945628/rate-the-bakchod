import Link from "next/link";
import type { ClientViewer } from "@/lib/types";
import { AuthButton } from "./auth-button";
import { BrandMark } from "./brand-mark";
import { CameraButton } from "./camera/camera-launcher";
import { InstallApp } from "./install-app";
import { NotificationBell } from "./notification-bell";

/**
 * The mark repeats here rather than living only in the rail, because the rail
 * becomes a bottom tab bar on phones and drops its tile — without this, the app
 * would have no logo at all on a phone.
 *
 * `app-chrome` is what an open thread hides on a phone; the rule is in
 * `app/globals.css`.
 */
export function TopBar({
  viewer,
  unread = 0,
}: {
  viewer: ClientViewer | null;
  /** Unread notifications, server-rendered so the badge is right on first paint. */
  unread?: number;
}) {
  return (
    <header className="app-chrome glass-bar sticky top-3 z-20 flex h-14 items-center justify-between gap-4 rounded-card px-4">
      <div className="min-w-0">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandMark className="h-5 w-5 shrink-0 text-ink lg:hidden" />
          <span className="min-w-0 truncate">
            <span className="text-[17px] font-bold tracking-tight text-ink">
              Rate the Bakchod
            </span>
            <span className="ml-2 hidden text-xs text-faint sm:inline">
              bakchodi, peer reviewed
            </span>
          </span>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Registers the service worker for everyone, and shows a button only if
            the browser offers to install. Signed out included: installing is not
            an account feature. */}
        <InstallApp />
        {/* Signed in only, for the same reason as the bell: both destinations a shot can
            go to need a session, and a camera that ends in a 401 is worse than no
            camera. */}
        {viewer && <CameraButton variant="bar" />}
        {/* Only for signed-in visitors: there is nothing to notify a stranger about,
            and the stream it listens on requires a session. */}
        {viewer && <NotificationBell initialUnread={unread} />}
        <AuthButton viewer={viewer} />
      </div>
    </header>
  );
}
