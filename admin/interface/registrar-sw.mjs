if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/pwa-sw.js").catch(() => {});
}
