import type { Metadata } from "next";
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
            dot is in the rail, and a call can arrive on any page. */}
        <RealtimeProvider enabled={viewer !== null}>
          {/* Inside the stream, because an invitation arrives on it — and outside the
              layout, because a call has to survive navigating away from the thread it
              was started from. */}
          <CallProvider>
            <div className="mx-auto flex w-full max-w-[1440px] gap-3 p-3">
              <SiteRail
                isAdmin={viewer?.isAdmin}
                handle={viewer?.handle}
                unreadConversations={unreadConversations}
              />
              <div className="min-w-0 flex-1">
                <TopBar viewer={viewer} unread={unread} />
                <main className="pb-28 pt-3 lg:pb-3">{children}</main>
              </div>
            </div>
          </CallProvider>
        </RealtimeProvider>
      </body>
    </html>
  );
}
