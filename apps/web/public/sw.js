/*
 * Hodos service worker.
 *
 * One job: let the shell open instantly and still open when the signal drops.
 * It never caches road data, shop pins or API responses — those must always be
 * live, and a stale hazard map would be worse than no map. Cached HTML is only
 * used when the network genuinely fails.
 */

const VERSION = "__HODOS_VERSION__";
const CACHE = `hodos-${VERSION}`;

const SHELL = [
  "/",
  "/map/",
  "/garage/",
  "/partners/",
  "/privacy.html",
  "/site.webmanifest",
  "/brandmark.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Cache each entry on its own: one 404 must not abort the whole install.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE && name.startsWith("hodos-")).map((name) =>
          caches.delete(name)
        )
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

/** Never let the worker touch data, uploads or third-party requests. */
function isBypassed(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/cdn-cgi/")) return true;
  return false;
}

function isNavigation(request) {
  return request.mode === "navigate" || request.destination === "document";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const shell = await cache.match("/", { ignoreSearch: true });
    if (shell) return shell;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Hodos</title><body style=\"font-family:system-ui;padding:40px;background:#faf8f2;color:#1c1a17\"><h1>You're offline</h1><p>Hodos needs a connection to load the live map. Try again when you're back.</p></body>",
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (isBypassed(event.request, url)) return;

  if (isNavigation(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || /\.(css|js|woff2?|png|svg|ico|json)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
