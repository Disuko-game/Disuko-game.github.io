const CACHE_NAME = "disuko-pwa-e071919bb20c";
const APP_SHELL = [
  "./",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./manifest.webmanifest",
  "./audio/table-v2/pickup-1.wav",
  "./audio/table-v2/pickup-2.wav",
  "./audio/table-v2/pickup-3.wav",
  "./audio/table-v2/drop-1.wav",
  "./audio/table-v2/drop-2.wav",
  "./audio/table-v2/drop-3.wav",
  "./audio/table-v2/click-1.wav",
  "./audio/table-v2/click-2.wav",
  "./audio/table-v2/click-3.wav",
  "./audio/table-v2/invalid-1.wav",
  "./audio/table-v2/completion-1.wav",
  "./audio/table-v2/bonus-1.wav",
  "./audio/table-v2/turn-1.wav",
  "./audio/table-v2/win-1.wav",
  "./audio/table-v2/dice-floor-1.wav",
  "./audio/table-v2/dice-wall-1.wav",
  "./audio/table-v2/dice-floor-2.wav",
  "./audio/table-v2/dice-wall-2.wav",
  "./audio/table-v2/dice-floor-3.wav",
  "./audio/table-v2/dice-wall-3.wav",
  "./audio/table-v2/dice-floor-4.wav",
  "./audio/table-v2/dice-wall-4.wav",
  "./audio/table-v2/dice-die-1.wav",
  "./audio/table-v2/dice-die-2.wav",
  "./audio/table-v2/dice-die-3.wav"
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
