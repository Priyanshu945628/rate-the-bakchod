/*
  The service worker.

  It exists for two reasons and deliberately does nothing else:

    1. An installed app has to survive being opened with no network. Without a
       worker, tapping the home-screen icon offline shows the browser's dinosaur
       inside a chromeless window, which looks like the app crashed.
    2. Chrome and Edge will not offer "Install app" for a site that has no worker
       able to answer a navigation.

  What it does NOT do is cache the app. A social feed whose HTML is served from a
  cache is a feed showing yesterday's posts, and a cached build shell outliving the
  build it belongs to is how a deploy breaks for the people who already had the app
  open. So:

    - `/_next/static/*` and `/icons/*` are cache-first. Both are immutable: the
      first is content-hashed by the build, the second changes only when the mark
      does and is versioned with this file.
    - Navigations go to the network, with `offline.html` as the fallback when it
      is not there. Nothing about a page is ever stored.
    - `/api/*` is not touched at all. That covers the realtime stream (buffering
      an EventSource through a worker breaks it), every mutation, and all media —
      DM images are private, and a cache the user cannot see is the wrong place
      for them.

  Bump VERSION to evict everything on the next visit.
*/

const VERSION = "rtb-1";
const STATIC = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC);
      await cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]);
      // Take over immediately. Safe here because nothing this worker serves is
      // version-coupled to the page that is already open.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Belt and braces for the realtime stream, which is under /api/ but must never
  // be held open by a worker even if that ever changes.
  if ((request.headers.get("accept") || "").includes("text/event-stream")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkThenOffline(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // 200 only: a 206 is a fragment and a redirect is not the thing that was asked
  // for, and neither is safe to replay later.
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}

async function networkThenOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC);
    const fallback = await cache.match(OFFLINE_URL);
    return fallback || Response.error();
  }
}
