export function page(request) {
  const path = new URL(request.url).pathname;
  if (!(path === "/" || path === "/borne" || path === "/notice" || /^\/planning-ecran\/?$/.test(path) || path === "/connexion" || /^\/gestion(?:\/[a-z-]+)?\/?$/.test(path))) return null;
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  return new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#000091"><meta name="description" content="Présences, planning et fréquentation du CDI"><title>TiceCDI</title><link rel="icon" href="/cdi/ticecdi-icon.webp" type="image/webp"><link rel="apple-touch-icon" href="/cdi/icon-192.png"><link rel="manifest" href="/cdi/manifest.webmanifest"><link rel="stylesheet" href="/cdi/cdi.css"><link rel="stylesheet" href="/cdi/theme-dark.css"><script type="module" src="/cdi/app.js"></script></head><body><a class="skip" href="#main">Aller au contenu</a><div id="app"><p class="loading" role="status">Chargement du CDI…</p></div></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
    },
  });
}
