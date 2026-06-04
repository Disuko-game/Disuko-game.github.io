export function registerServiceWorker(): void {
  const localInstallHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  if (!("serviceWorker" in navigator) || (!import.meta.env.PROD && !localInstallHost)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      // The app remains fully playable without the offline shell.
    });
  });
}
