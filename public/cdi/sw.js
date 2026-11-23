// Service worker de TiceCDI : la borne reste affichée et se reconnecte seule si le serveur ou le réseau tombe.
// Les données (API) ne sont jamais mises en cache : seuls les fichiers de l'interface le sont.
const VERSION = "ticecdi-1.13.3";
const base = new URL("cdi/", self.registration.scope);
const shell = ["cdi.css", "theme-dark.css", "app.js", "shared.js", "schedule.js", "attendance.js", "school.js", "planning-pdf.js",
  "privacy.js", "account.js", "qr.js", "charts.js", "offline.js", "ticecdi-logo.webp", "ticecdi-icon.webp"].map((file) => new URL(file, base).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(shell)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("ticecdi-") && key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function offlinePage() {
  const css = new URL("cdi.css", base).href, script = new URL("offline.js", base).href, logo = new URL("ticecdi-icon.webp", base).href;
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TiceCDI · Reconnexion</title><link rel="stylesheet" href="${css}"><script type="module" src="${script}"></script></head>
<body><main class="wrap kiosk offline-page" id="main"><section class="panel panel-body home-card">
<img class="tice-brand-icon" src="${logo}" width="96" height="96" alt="TiceCDI"><h1>Connexion au serveur perdue</h1>
<p>La borne se reconnecte automatiquement dès que le réseau ou le serveur du CDI est de nouveau disponible.</p>
<p class="subtle" role="status" id="offline-status">Nouvelle tentative dans quelques secondes…</p></section></main></body></html>`, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/") || (url.searchParams.get("route") || "").startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlinePage()));
    return;
  }
  if (url.href.startsWith(base.href)) {
    // Réseau d'abord pour toujours servir la dernière version, cache en secours hors connexion.
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || Response.error())));
  }
});
