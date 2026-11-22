import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { api, model } from "../cdi/service.mjs";
import { maintain } from "../cdi/privacy.mjs";
import { page } from "../cdi/shell.mjs";
import { openDatabase } from "./sqlite.mjs";

const data = resolve(process.env.CDI_DATA_DIR || "./data");
process.umask(0o077);
await mkdir(data, { recursive: true });
const DB = openDatabase(join(data, "cdi.sqlite"), new URL("../drizzle/", import.meta.url));
const runMaintenance = () => maintain(model(DB)).catch(() => console.error("TiceCDI · échec de la purge."));
await runMaintenance();
const maintenanceTimer = setInterval(runMaintenance, 60_000);
maintenanceTimer.unref();
const port = Number(process.env.PORT || 8080);
let setupKey = process.env.CDI_SETUP_KEY;
if (!await DB.prepare("SELECT id FROM accounts LIMIT 1").bind().first()) {
  if (!setupKey) {
    const keyPath = join(data, "installation.key");
    try { setupKey = (await readFile(keyPath, "utf8")).trim(); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      setupKey = randomBytes(16).toString("hex");
      try { await writeFile(keyPath, setupKey + "\n", { flag:"wx", mode:0o600 }); }
      catch (writeError) {
        if (writeError.code !== "EEXIST") throw writeError;
        setupKey = (await readFile(keyPath, "utf8")).trim();
      }
    }
  }
  if (process.env.CDI_SETUP_KEY) console.log("Première configuration : utilisez la valeur de CDI_SETUP_KEY.");
  else console.log("Clé de première configuration du CDI :", setupKey);
}

const assets = new Map([
  ["cdi.css", "text/css; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["shared.js", "text/javascript; charset=utf-8"],
  ["schedule.js", "text/javascript; charset=utf-8"],
  ["attendance.js", "text/javascript; charset=utf-8"],
  ["school.js", "text/javascript; charset=utf-8"],
  ["planning-pdf.js", "text/javascript; charset=utf-8"],
  ["privacy.js", "text/javascript; charset=utf-8"],
  ["account.js", "text/javascript; charset=utf-8"],
  ["qr.js", "text/javascript; charset=utf-8"],
  ["offline.js", "text/javascript; charset=utf-8"],
  ["theme-dark.css", "text/css; charset=utf-8"],
  ["manifest.webmanifest", "application/manifest+json; charset=utf-8"],
  ["ticecdi-logo.webp", "image/webp"],
  ["ticecdi-icon.webp", "image/webp"],
  ["icon-192.png", "image/png"],
  ["icon-512.png", "image/png"],
  ["icon-maskable-512.png", "image/png"],
]);
async function requestHandler(request, client) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return api(request, { DB, CDI_SETUP_KEY: setupKey }, { client });
  const shell = page(request);
  if (shell) return shell;
  const asset = url.pathname.match(/^\/cdi\/([a-z0-9.-]+)$/)?.[1];
  if (assets.has(asset) && ["GET", "HEAD"].includes(request.method)) {
    const body = await readFile(new URL("../public/cdi/" + asset, import.meta.url));
    return new Response(body, { headers: { "Content-Type": assets.get(asset), "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
  }
  if (url.pathname === "/sw.js" && ["GET", "HEAD"].includes(request.method)) {
    // Le service worker est servi à la racine pour couvrir /borne ; sa CSP l'autorise à joindre le serveur.
    const body = await readFile(new URL("../public/cdi/sw.js", import.meta.url));
    return new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'", "Service-Worker-Allowed": "/" } });
  }
  if (url.pathname === "/healthz" && request.method === "GET") return new Response("ok");
  return new Response("Page introuvable.", { status: 404 });
}

const trustProxy = process.env.CDI_TRUST_PROXY === "1";
const allowedMethods = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);
const permissions = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), fullscreen=(self)";
// En-têtes de sécurité ajoutés à toutes les réponses (pages, API, ressources et erreurs).
function securityHeaders(headers, secure) {
  const result = Object.fromEntries(headers);
  const defaults = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": permissions,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (secure) defaults["Strict-Transport-Security"] = "max-age=31536000";
  for (const [name, value] of Object.entries(defaults)) if (!(name.toLowerCase() in result)) result[name] = value;
  return result;
}
function clientAddress(incoming) {
  if (trustProxy) {
    const chain = String(incoming.headers["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return incoming.socket.remoteAddress;
}

const server = createServer(async (incoming, outgoing) => {
  const forwardedHttps = trustProxy && incoming.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https";
  const secure = process.env.CDI_ORIGIN ? process.env.CDI_ORIGIN.startsWith("https://") : forwardedHttps;
  const reply = (status, text = "") => outgoing.writeHead(status, securityHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" }), secure)).end(text);
  try {
    const method = incoming.method || "GET";
    if (!allowedMethods.has(method)) { reply(405, "Méthode indisponible."); return; }
    if ((incoming.url || "").length > 4096) { reply(414, "Adresse trop longue."); return; }
    const base = process.env.CDI_ORIGIN || `${forwardedHttps ? "https" : "http"}://${incoming.headers.host || "localhost:" + port}`;
    const fullUrl = new URL(incoming.url || "/", base);
    if (fullUrl.origin !== new URL(base).origin) { reply(400, "Requête invalide."); return; }
    const request = new Request(fullUrl, {
      method, headers:incoming.headers,
      ...(["GET", "HEAD"].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex:"half" }),
    });
    const response = await requestHandler(request, clientAddress(incoming));
    outgoing.writeHead(response.status, securityHeaders(response.headers, secure));
    if (method === "HEAD" || !response.body) outgoing.end();
    else await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch (error) {
    console.error("TiceCDI HTTP", error.name);
    if (!outgoing.headersSent) reply(500, "Service indisponible.");
    else outgoing.destroy();
  }
});
// Limite les connexions lentes ou abandonnées (slowloris).
server.headersTimeout = 20_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.listen(port, "0.0.0.0", () => console.log(`TiceCDI à l’écoute sur le port ${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => {
  clearInterval(maintenanceTimer);
  DB.database.close();
  process.exit(0);
}));
