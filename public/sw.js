const CACHE_NAME = "disuko-pwa-v5";
const APP_SHELL = [
  "./",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          if (isCacheable(event.request, response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./"));
    })
  );
});

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
}

function isCacheable(request, response) {
  return (
    response.ok &&
    new URL(request.url).origin === self.location.origin &&
    !request.url.endsWith("/sw.js")
  );
}

function networkFirst(request) {
  return fetch(request, { cache: "no-store" })
    .then((response) => {
      if (isCacheable(request, response)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("./", copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || caches.match("./")));
}
