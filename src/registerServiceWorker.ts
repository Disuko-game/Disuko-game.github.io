export function registerServiceWorker(): void {
  const localDevHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!import.meta.env.PROD && localDevHost) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => caches.keys())
        .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
        .catch(() => {
          // Local dev still works if cleanup fails.
        });
    });
    return;
  }

  if (!import.meta.env.PROD) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      // The app remains fully playable without the offline shell.
    });
  });
}
