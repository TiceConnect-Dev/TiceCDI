import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { api as nodeApi } from "../cdi/service.mjs";
import { parisClock, presenceDeadline, shiftDay } from "../cdi/calendar.mjs";
import { openDatabase } from "../standalone/sqlite.mjs";

const root = mkdtempSync(join(tmpdir(), "gestion-cdi-php-"));
const web = join(root, "public");
const dataDir = join(root, "data");
const php = process.env.PHP_BIN || "php";
let server;
let output = "";
const pause = 50;
const setupKey = "test-php";
const password = "MotDePasse-Pour-Test-Uniquement";

async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  socket.close();
  await once(socket, "close");
  return port;
}

try {
  mkdirSync(web);
  execFileSync("unzip", ["-q", process.argv[2] ?? "dist/Gestion-CDI-PHP.zip", "-d", web]);
  const address = "127.0.0.1:" + await freePort();
  const origin = "http://" + address;
  const base = origin + "/Gestion-CDI-PHP";
  const entry = base + "/index.php";
  const route = (path) => {
    const target = new URL(path, origin);
    target.searchParams.set("route", target.pathname);
    return entry + "?" + target.searchParams;
  };
  const env = { ...process.env, CDI_DATA_DIR: dataDir, CDI_ORIGIN: "", CDI_SETUP_KEY: "" };
  server = spawn(php, ["-S", address, "-t", web], { env, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", (chunk) => { output += chunk; });
  let running = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(route("/healthz"));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "ok");
      running = true;
      break;
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
      await delay(pause);
    }
  }
  assert.ok(running, "Le serveur PHP doit répondre");

  const html = await (await fetch(route("/gestion"))).text();
  assert.match(html, /name="cdi-entry" content="\/Gestion-CDI-PHP\/index\.php"/);
  const bundle = await (await fetch(base + "/cdi/shared.js")).text();
  assert.match(bundle, /function urlFor/);
  let cookie = "";
  async function call(path, method = "GET", body, status = 200, session = cookie) {
    const response = await fetch(route("/api" + path), {
      method,
      headers: { Cookie: session, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, status, method + " " + path + " " + JSON.stringify(result));
    if (response.headers.has("set-cookie")) {
      assert.match(response.headers.get("set-cookie"), /path=\/Gestion-CDI-PHP\//i);
      cookie = response.headers.get("set-cookie").split(";")[0];
    }
    return result;
  }

  assert.equal((await call("/auth/status")).setup, true);
  assert.equal((await fetch(origin + "/data/installation.key")).status, 404);
  const key = readFileSync(join(dataDir, "installation.key"), "utf8").trim();
  await call("/auth/setup", "POST", { key: "incorrecte", username: "admin", name: "Admin de test", password }, 403);
  await call("/auth/setup", "POST", { key, username: "admin", name: "Admin de test", password });
  const admin = cookie;
  await call("/gestion/comptes", "POST", { username: "lecture", name: "Vie scolaire", password, rights: ["presence"] });
  await call("/auth/login", "POST", { username: "lecture", password });
  const viewer = cookie;
  cookie = admin;
  assert.equal((await call("/auth/status")).user.admin, true);
  await call("/gestion/sauvegarde", "GET", undefined, 403, viewer);
  await call("/gestion/sauvegarde", "GET", undefined, 401, "");
  await call("/gestion/reglages", "PATCH", { open: true, second_hour: true, message: "Test", capacity: 5, hide_weekend: true });
  await call("/gestion/horaires", "PATCH", { use_hours: false, hours: [{ weekday: 1, start_min: 480, end_min: 720 }] });

  const rows = [
    { first_name: "Éva", last_name: "Démo", class_name: "5e A", external_id: "PHP-01" },
    { first_name: "Nils", last_name: "Démo", class_name: "5e A", external_id: "PHP-02" },
    { first_name: "Amélie", last_name: "Démo", class_name: "5e A", external_id: "PHP-03" },
  ];
  assert.equal((await call("/gestion/import", "POST", { rows, preview: true })).added, 3);
  assert.equal((await call("/gestion/classes")).rows.length, 0);
  await call("/gestion/import", "POST", { rows });
  const [a, b, c] = (await call("/gestion/eleves?badges=1")).rows;
  const classe = a.class_id;
  assert.equal((await call("/borne/recherche?q=eva", "GET", undefined, 200, "")).results[0].first_name, "Éva");
  const start = Date.now();
  const bench = await call("/borne/entree", "POST", { code: a.code, two_hours: true }, 200, "");
  const after = Date.now();
  const presence = (await call("/gestion/presences", "GET", undefined, 200, viewer)).rows[0];
  assert.ok(presence.starts_at >= start && presence.starts_at <= after);
  assert.equal(bench.expires_at, presenceDeadline(presence.starts_at, 2));
  const extension = { expires_at: bench.expires_at, minutes: 30 };
  await call("/gestion/presences/" + presence.id, "PATCH", extension, 403, viewer);
  assert.equal((await call("/gestion/presences/" + presence.id, "PATCH", extension)).expires_at, bench.expires_at + 1_800_000);
  await call("/gestion/presences/" + presence.id, "PATCH", extension, 409);

  const group = (await call("/gestion/groupes", "POST", { name: "Atelier de test", student_ids: [a.id, b.id, c.id] })).id;
  const now = parisClock();
  const monday = shiftDay(now.day, 1 - now.weekday);
  await call("/gestion/planning", "POST", { day: now.day, start_min: 540, end_min: 600, title: "Atelier test", kind: "atelier",
    notes: "Note interne", group_id: group });
  const plan = (await call("/gestion/planning?week=" + monday)).rows[0];
  const publicPlan = (await call("/planning?week=" + monday, "GET", undefined, 200, "")).rows[0];
  assert.equal(plan.notes, "Note interne");
  assert.equal(Object.hasOwn(publicPlan, "notes"), false);
  const opened = await call("/gestion/seances", "POST", {
    request_id: crypto.randomUUID(), kind: "groupe", roster_id: group, plan_id: plan.id, duration: 120, student_ids: [b.id],
  });
  assert.equal(opened.rows.find((row) => row.student_id === b.id).status, "present");
  assert.equal(opened.rows.find((row) => row.student_id === c.id).status, "absent");
  assert.equal((await call("/gestion/seances/" + opened.session.id + "/fin", "POST", { keep_student_ids: [] })).closed, 1);
  const counts = await call("/gestion/statistiques?from=" + now.day + "&to=" + now.day);
  assert.equal(counts.visits, 2);
  assert.equal(counts.hours.reduce((total, visits) => total + visits, 0), 2);

  const phpBackup = await call("/gestion/sauvegarde");
  assert.equal(Object.hasOwn(phpBackup.tables, "accounts"), false);
  const invalid = structuredClone(phpBackup);
  invalid.tables.students[0].class_id = "classe-inconnue";
  await call("/gestion/sauvegarde", "POST", { backup: invalid }, 400);
  assert.equal((await call("/gestion/eleves")).rows.length, 3);
  const db = openDatabase(":memory:", new URL("../drizzle/", import.meta.url));
  try {
    let nodeCookie = "";
    async function nodeCall(path, method = "GET", body) {
      const response = await nodeApi(new Request("http://node.test/api" + path, {
        method, headers: { Cookie: nodeCookie, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), { DB: db, CDI_SETUP_KEY: setupKey });
      const data = await response.json();
      assert.equal(response.status, 200, method + " " + path + " " + JSON.stringify(data));
      if (response.headers.has("set-cookie")) nodeCookie = response.headers.get("set-cookie").split(";")[0];
      return data;
    }
    await nodeCall("/auth/setup", "POST", { key: setupKey, username: "admin", name: "Admin Node", password });
    const preview = await nodeCall("/gestion/sauvegarde", "POST", { backup: phpBackup });
    assert.equal(preview.counts.visits, 2);
    await nodeCall("/gestion/sauvegarde", "POST", { backup: phpBackup, token: preview.token });
    const nodeBackup = await nodeCall("/gestion/sauvegarde");
    const nodePreview = await call("/gestion/sauvegarde", "POST", { backup: nodeBackup });
    await call("/gestion/sauvegarde", "POST", { backup: nodeBackup, token: nodePreview.token });
    assert.deepEqual((await call("/gestion/classes")).rows, [{ id: classe, name: "5e A", total: 3 }]);
    assert.equal((await call("/auth/status")).user.name, "Admin de test");
  } finally {
    db.database.close();
  }

  const year = await call("/gestion/annees");
  const change = { from: year.current, to: year.next, rows: [{ ...rows[0], class_name: "4e A" }] };
  const preview = await call("/gestion/annees", "POST", change);
  assert.equal(preview.counts.moved, 1);
  await call("/gestion/annees", "POST", { ...change, token: preview.token });
  assert.equal((await call("/gestion/annees/" + year.current)).rows.length, 3);
  assert.equal((await call("/gestion/eleves?badges=1")).rows[0].class_name, "4e A");
  console.log("OK · ZIP PHP en sous-dossier, borne, permissions, planning, fiches d’appel, statistiques, sauvegardes PHP/Node et année scolaire.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (server && server.exitCode === null && server.kill()) {
    await once(server, "exit");
  }
  rmSync(root, { recursive: true, force: true });
}
