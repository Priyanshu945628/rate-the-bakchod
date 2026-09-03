import type { MetadataRoute } from "next";

/**
 * The install manifest — served at `/manifest.webmanifest`, linked from the root
 * layout's `metadata.manifest`.
 *
 * This is what makes the browser offer "Install app" on desktop Chrome/Edge and
 * "Add to home screen" on Android. iOS reads only `display` and the
 * `apple-touch-icon` (`app/apple-icon.png`); everything else here it ignores.
 *
 * `background_color` is the ground, not white: it is painted on the splash screen
 * in the moment between tapping the icon and the first frame of the app, and a
 * white flash before a near-black UI is the one thing an installed app can do that
 * a tab cannot.
 *
 * Two icon shapes on purpose — see `scripts/make-icons.mjs`, which draws them.
 *
 * Static: nothing in here reads a request, so Next renders it once at build time.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Rate the Bakchod",
    short_name: "Bakchod",
    description: "Post the evidence, let the internet score the bakchodi.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Desktop gets a plain app window rather than the title-bar overlay: the top
    // bar is already the app's own chrome and would end up beside a second one.
    display_override: ["standalone", "minimal-ui"],
    background_color: "#08090a",
    theme_color: "#08090a",
    dir: "ltr",
    lang: "en",
    categories: ["social", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press the installed icon. The same three places the rail goes, minus
    // the profile — a shortcut to a route that redirects when signed out is a
    // shortcut that sometimes lies.
    shortcuts: [
      { name: "Feed", url: "/" },
      { name: "Leaderboard", url: "/leaderboard" },
      { name: "Messages", url: "/messages" },
    ],
  };
}
