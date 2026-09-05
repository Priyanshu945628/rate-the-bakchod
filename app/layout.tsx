import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { unreadConversationCount } from "@/lib/messages";
import { unreadCount } from "@/lib/notifications";
import { toClientViewer } from "@/lib/posts";
import { CallProvider } from "@/components/call/call-provider";
import { RealtimeProvider } from "@/components/realtime-provider";
import { SiteRail } from "@/components/site-rail";
import { TopBar } from "@/components/top-bar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rate the Bakchod",
  description:
    "Post the evidence, let the internet score the bakchodi. Leaderboard included.",
  // `app/manifest.ts`. Without this link the browser never looks for it, and
  // nothing is installable.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // iOS has no manifest: this is what makes a home-screen launch open without
    // Safari's chrome, and it is the only way to say so on that platform.
    capable: true,
    title: "Bakchod",
    // `black`, not `black-translucent`. Translucent lets the page run under the
    // status bar, and the top bar is 12px from the top of the viewport — it would
    // be sitting under the clock.
    statusBarStyle: "black",
  },
};

/**
 * `themeColor` paints the browser's own chrome — the Android address bar, the
 * desktop title bar of an installed window — the same near-black as the ground, so
 * the app does not sit in a light frame. One value, not a light/dark pair: this UI
 * has no light mode.
 *
 * `interactiveWidget: "resizes-content"` asks the browser to shrink the layout
 * viewport when the on-screen keyboard opens. Android honours it, which is what
 * makes `dvh` track the keyboard there. iOS ignores it — that is what
 * `components/keyboard-inset.tsx` and `--kb` are for — but asking costs nothing and
 * removes the Android half of the problem before any JavaScript runs.
 *
 * `maximumScale` and `userScalable` are deliberately left alone: locking zoom is
 * the standard way an app becomes unusable for anybody who needs to enlarge it.
 */
export const viewport: Viewport = {
  themeColor: "#08090a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

/**
 * Which palette in `app/globals.css` is live. Change this one word to switch:
 * `graphite` (neutral near-black, white accent), `onyx` (true black, maximum
 * contrast), `slate` (cool blue-grey ground, white accent), `plum` (neutral
 * ground, muted violet accent — the only one with a real hue).
 *
 * To compare without a rebuild, set it in the console instead:
 * `document.documentElement.dataset.palette = "onyx"`.
 */
const PALETTE = "graphite";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved once here and passed down; `getCurrentUser` is request-cached, so
  // pages that need the full row again do not pay a second query.
  const user = await getCurrentUser();
  const viewer = toClientViewer(user);
  // Server-rendered so the badge is correct in the first paint rather than popping
  // in once the stream connects.
  const [unread, unreadConversations] = user
    ? await Promise.all([unreadCount(user.id), unreadConversationCount(user.id)])
    : [0, 0];

  return (
    <html
      lang="en"
      data-palette={PALETTE}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/*
          No ambient wash behind the app. The panels carry their own surface
          tone, so there is nothing here for a blurred shape to improve — and a
          large soft coloured circle is exactly the glow the theme rules out.
          The blur on `panel` still does real work where a panel scrolls over
          content.
        */}
        {/* The provider wraps everything: the bell is in the top bar, the unread
            dot is in the rail — or beside the bell on a phone — and a call can
            arrive on any page. */}
        <RealtimeProvider enabled={viewer !== null}>
          {/* Inside the stream, because an invitation arrives on it — and outside the
              layout, because a call has to survive navigating away from the thread it
              was started from. */}
          <CallProvider>
            {/* `app-frame`, `app-main` and the `app-chrome` on both bars are the
                hooks a full-screen thread hides itself behind — see the last block
                of `app/globals.css`. They carry nothing on their own. */}
            <div className="app-frame mx-auto flex w-full max-w-[1440px] gap-3 p-3">
              <SiteRail
                isAdmin={viewer?.isAdmin}
                handle={viewer?.handle}
                unreadConversations={unreadConversations}
              />
              <div className="min-w-0 flex-1">
                <TopBar
                  viewer={viewer}
                  unread={unread}
                  unreadConversations={unreadConversations}
                />
                {/* `pb-28` reserves the floating tab bar's height on phones.
                    `kb-flush` gives it back while the keyboard is up, because the
                    tab bar has hidden itself by then and the space would otherwise
                    be a gap under the composer. */}
                <main className="app-main kb-flush pb-28 pt-3 lg:pb-3">{children}</main>
              </div>
            </div>
          </CallProvider>
        </RealtimeProvider>
      </body>
    </html>
  );
}
