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
  ["ticecdi-logo.webp", "image/webp"],
  ["ticecdi-icon.webp", "image/webp"],
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
  if (url.pathname === "/healthz" && request.method === "GET") return new Response("ok");
  return new Response("Page introuvable.", { status: 404 });
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const secure = process.env.CDI_TRUST_PROXY === "1" && incoming.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https";
    const base = process.env.CDI_ORIGIN || `${secure ? "https" : "http"}://${incoming.headers.host || "localhost:" + port}`;
    const fullUrl = new URL(incoming.url || "/", base);
    if (fullUrl.origin !== new URL(base).origin) { outgoing.writeHead(400).end(); return; }
    const method = incoming.method || "GET";
    const request = new Request(fullUrl, {
      method, headers:incoming.headers,
      ...(["GET", "HEAD"].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex:"half" }),
    });
    const response = await requestHandler(request, incoming.socket.remoteAddress);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (method === "HEAD" || !response.body) outgoing.end();
    else await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch (error) {
    console.error("TiceCDI HTTP", error.name);
    if (!outgoing.headersSent) outgoing.writeHead(500).end("Service indisponible.");
    else outgoing.destroy();
  }
});
server.listen(port, "0.0.0.0", () => console.log(`TiceCDI à l’écoute sur le port ${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => {
  clearInterval(maintenanceTimer);
  DB.database.close();
  process.exit(0);
}));
