import { audit, auditRows } from "./audit.mjs";
import { exportBackup, inspectBackup, maxBackupBytes, restoreBackup } from "./backup.mjs";
import { occupancy, seatsSql } from "./capacity.mjs";
import { changeCall, changeGroup, finishSession, groups, members, roster, sessionDetail, sessionsList, startSession } from "./school.mjs";
import { archiveRows, rollover, years } from "./school-year.mjs";
import { changeSlot, dayLength, duplicateWeek, hourLength as HOUR, kioskClosure, normalizeHours, openingHours, parisClock, presenceDeadline, saveOpeningHours, shiftDay, validDay, weekday, weekPlanning } from "./calendar.mjs";
import { classRoster, groupArrival, statistics } from "./operations.mjs";

export const RIGHTS = ["presence", "sorties", "exclusions", "eleves", "classes", "import", "badges", "comptes", "arrivees", "planning", "statistiques", "groupes"];
const encoder = new TextEncoder();
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const personColumns = "s.id,s.first_name,s.last_name,c.name AS class_name,s.class_id";
const peopleSelect = `SELECT ${personColumns} FROM students s JOIN classes c ON c.id=s.class_id`;

class InputError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new InputError(status, message); }
function clean(value) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""; }
function normalize(value) { return clean(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae"); }
function words(value) { return normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function label(value, field, limit = 100) {
  const result = clean(value);
  if (!result || result.length > limit) fail(400, `${field} doit contenir entre 1 et ${limit} caractères.`);
  return result;
}
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function random(bytes) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
function id() { return crypto.randomUUID(); }
function barcode() { return "CDI" + random(5).toUpperCase(); }
function today() { return dateFormatter.format(new Date()); }
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function digest(value) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
async function passwordHash(password, salt = random(16)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return salt + ":" + hex(new Uint8Array(bits));
}
function newPassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 160) fail(400, "Le mot de passe doit contenir entre 12 et 160 caractères.");
  return value;
}
function username(value) {
  const name = clean(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(name)) fail(400, "Saisissez un identifiant d’au moins 3 caractères (lettres sans accent, chiffres, point, tiret, @ ou _).");
  return name;
}
function json(data, status = 200, headers = {}) {
  return jsonResponse(JSON.stringify(data), status, headers);
}
function jsonResponse(serialized, status = 200, headers = {}) {
  return new Response(serialized, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
async function payload(request, maxBytes = 2_000_000) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) fail(415, "Format de requête invalide.");
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let length = 0;
  if (!reader) fail(400, "Données manquantes.");
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); fail(413, "Le fichier est trop volumineux."); }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const obj = JSON.parse(text + decoder.decode());
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch { /* Report invalid data below. */ }
  fail(400, "Données invalides.");
}
function cookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `cdi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
function model(db) {
  const stmt = (sql, ...params) => db.prepare(sql).bind(...params);
  return {
    stmt,
    one: (sql, ...params) => stmt(sql, ...params).first(),
    list: async (sql, ...params) => (await stmt(sql, ...params).all()).results,
    run: (sql, ...params) => stmt(sql, ...params).run(),
    batch: (statements) => db.batch(statements),
  };
}
function changes(result) { return result.meta.changes; }
async function kioskSettings(m) {
  const settings = await m.one("SELECT is_open, allow_second_hour, message, capacity, hide_weekend FROM kiosk_settings WHERE id=1");
  return {
    open: settings?.is_open !== 0,
    second_hour: settings?.allow_second_hour !== 0,
    message: settings?.message ?? "",
    capacity:settings?.capacity ?? null,
    hide_weekend:settings?.hide_weekend===1,
  };
}
function publicAccount(row) {
  return { id: row.id, username: row.username, name: row.name, admin: Boolean(row.admin), rights: row.admin ? RIGHTS : JSON.parse(row.permissions) };
}
async function authenticate(m, request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const row = await m.one("SELECT a.* FROM sessions t JOIN accounts a ON a.id=t.account_id WHERE t.token=? AND t.expires_at>?", await digest(token), Date.now());
  return row ? publicAccount(row) : null;
}
async function openSession(m, request, accountId) {
  const now = Date.now();
  const token = random(32);
  await m.batch([
    m.stmt("DELETE FROM sessions WHERE expires_at<=?", now),
    m.stmt("INSERT INTO sessions VALUES (?,?,?)", await digest(token), accountId, now + 12 * HOUR),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": cookie(request, token, 12 * 3600) });
}
async function throttle(m, key, limit, minutes = 1) {
  const slot = Math.floor(Date.now() / (minutes * 60_000)) * minutes;
  const results = await m.batch([
    m.stmt("DELETE FROM rate_limits WHERE slot<?", slot - 60),
    m.stmt("INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(scope,slot) DO UPDATE SET count=count+1 RETURNING count", key, slot),
  ]);
  if (results[1].results[0].count > limit) fail(429, "Trop de tentatives. Réessayez dans quelques instants.");
}
function className(value) { return label(value, "Le nom de la classe", 45); }
function studentData(body) {
  const first_name = label(body.first_name, "Le prénom", 75);
  const last_name = label(body.last_name, "Le nom", 75);
  const name_key = words(last_name) + "|" + words(first_name);
  const search_name = words(first_name + " " + last_name);
  if (!words(first_name) || !words(last_name)) fail(400, "Saisissez un nom et un prénom valides.");
  const external_id = clean(body.external_id) || null;
  if (external_id?.length > 120) fail(400, "L’identifiant externe dépasse 120 caractères.");
  return { first_name, last_name, name_key, search_name, external_id };
}
async function saveStudent(m, body, studentId) {
  const s = studentData(body);
  const classId = clean(body.class_id);
  if (!await m.one("SELECT id FROM classes WHERE id=?", classId)) fail(400, "Sélectionnez une classe existante.");
  if (s.external_id && await m.one("SELECT id FROM students WHERE external_id=? AND id<>?", s.external_id, studentId ?? "")) fail(409, "Cet identifiant externe est déjà utilisé.");
  if (studentId) {
    const updated = await m.run("UPDATE students SET first_name=?,last_name=?,search_name=?,name_key=?,class_id=?,external_id=?,active=CASE WHEN ?=1 THEN 1 ELSE active END WHERE id=?", s.first_name, s.last_name, s.search_name, s.name_key, classId, s.external_id, Number(body.reactivate === true), studentId);
    if (!changes(updated)) fail(404, "Élève introuvable.");
  } else {
    await m.run("INSERT INTO students VALUES (?,?,?,?,?,?,?,?,1)", id(), s.first_name, s.last_name, s.search_name, s.name_key, classId, barcode(), s.external_id);
  }
  return { ok: true };
}
async function importStudents(m, data) {
  if (!Array.isArray(data.rows) || !data.rows.length || data.rows.length > 5000) fail(400, "L’import accepte de 1 à 5 000 lignes.");
  const [classes, students] = await Promise.all([
    m.list("SELECT * FROM classes"),
    m.list("SELECT s.id,s.active,s.external_id,s.name_key,c.normalized AS class_key FROM students s JOIN classes c ON c.id=s.class_id"),
  ]);
  const byClass = new Map(classes.map((c) => [c.normalized, c]));
  const byRef = new Map(students.filter((s) => s.external_id).map((s) => [s.external_id, s]));
  const byName = new Map();
  for (const s of students) {
    const key = s.name_key + "|" + s.class_key;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  const newClasses = [];
  const newStudents = [];
  const updates = [];
  const errors = [];
  const inputKeys = new Set();
  const targetedIds = new Set();
  let skipped = 0;
  for (const [index, raw] of data.rows.entries()) {
    try {
      if (!raw || typeof raw !== "object") fail(400, "Ligne invalide.");
      const s = studentData(raw);
      const name = className(raw.class_name);
      const normalized = normalize(name);
      const nameClass = s.name_key + "|" + normalized;
      const key = s.external_id ? "ref:" + s.external_id : "name:" + nameClass;
      if (inputKeys.has(key)) { skipped++; continue; }
      const matches = byName.get(nameClass) ?? [];
      let existing = s.external_id ? byRef.get(s.external_id) : null;
      if (!existing) {
        const candidates = s.external_id ? matches.filter((m) => !m.external_id) : matches;
        if (candidates.length > 1) fail(409, "Plusieurs élèves correspondent. Utilisez un identifiant externe unique.");
        existing = candidates[0];
      }
      if (existing && targetedIds.has(existing.id)) fail(409, "Cet élève apparaît plusieurs fois dans le fichier.");
      inputKeys.add(key);
      if (!byClass.has(normalized)) {
        const c = { id: id(), name, normalized };
        byClass.set(normalized, c);
        newClasses.push(c);
      }
      const entry = { ...s, class_key: normalized, id: existing?.id ?? id() };
      if (existing) {
        targetedIds.add(existing.id);
        entry.external_id ??= existing.external_id;
        updates.push(entry);
      } else {
        entry.code = barcode();
        newStudents.push(entry);
      }
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      errors.push({ line: index + 2, message: error.message });
    }
  }
  let result = { added: newStudents.length, updated: updates.length, classes: newClasses.length, skipped, errors };
  if (data.preview) return result;
  if (errors.length) fail(400, "Corrigez les lignes signalées avant de confirmer l’import.");
  const finished = await m.batch([
    m.stmt(`INSERT OR IGNORE INTO classes
      SELECT value->>'id',value->>'name',value->>'normalized' FROM json_each(?)`, JSON.stringify(newClasses)),
    m.stmt(`WITH incoming AS (SELECT value AS j FROM json_each(?))
      UPDATE students AS s SET first_name=j->>'first_name',last_name=j->>'last_name',
      search_name=j->>'search_name', name_key=j->>'name_key', class_id=c.id,
      external_id=j->>'external_id',active=1
      FROM incoming JOIN classes c ON c.normalized=j->>'class_key' WHERE s.id=j->>'id'`, JSON.stringify(updates)),
    m.stmt(`INSERT OR IGNORE INTO students
      SELECT j->>'id',j->>'first_name',j->>'last_name',j->>'search_name',j->>'name_key',c.id,j->>'code',j->>'external_id',1
      FROM (SELECT value AS j FROM json_each(?)) JOIN classes c ON c.normalized=j->>'class_key'
      WHERE (j->>'external_id') IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM students s WHERE s.name_key=j->>'name_key' AND s.class_id=c.id)`, JSON.stringify(newStudents)),
  ]);
  result = { ...result, classes: changes(finished[0]), updated: changes(finished[1]), added: changes(finished[2]), skipped: skipped + newStudents.length - changes(finished[2]) };
  return result;
}
const demoRows = [
  ["Emma", "Bernard", "6e A"], ["Hugo", "Moreau", "5e B"], ["Inès", "Dupont", "4e A"], ["Lucas", "Martin", "3e C"],
  ["Lina", "Richard", "2de 1"], ["Jules", "Petit", "1re G1"], ["Sarah", "Durand", "Tle G2"], ["Élio", "Thomas", "6e A"],
].map(([first_name, last_name, class_name]) => ({ first_name, last_name, class_name }));

async function dispatch(request, env, options) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  const m = model(env.DB);
  const clock = Date.now();
  const client = options.hosted ? request.headers.get("cf-connecting-ip") || "borne" : options.client || "borne";
  if (method !== "GET") {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== url.host)) fail(403, "Requête non autorisée.");
  }
  const setupAllowed = options.hosted && Boolean(request.headers.get("oai-authenticated-user-id"));
  if (method === "GET" && path === "/api/auth/status") {
    const [user, account] = await Promise.all([authenticate(m, request), m.one("SELECT id FROM accounts LIMIT 1")]);
    return json({ user, setup: !account, keyRequired: !setupAllowed, demoAllowed: options.hosted });
  }
  if (method === "POST" && path === "/api/auth/setup") {
    await throttle(m, "setup:" + client, 15, 10);
    const data = await payload(request);
    if (!setupAllowed && (!env.CDI_SETUP_KEY || !equal(data.key, env.CDI_SETUP_KEY))) fail(403, "Clé d’installation incorrecte.");
    const accountId = id();
    const login = username(data.username);
    const name = label(data.name, "Le nom d’affichage");
    const secret = await passwordHash(newPassword(data.password));
    const created = await m.run("INSERT INTO accounts SELECT ?,?,?,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM accounts)", accountId, login, name, secret, "[]");
    if (!changes(created)) fail(409, "Un compte administrateur existe déjà.");
    if (options.hosted && data.demo) await importStudents(m, { rows: demoRows });
    return openSession(m, request, accountId);
  }
  if (method === "POST" && path === "/api/auth/login") {
    const data = await payload(request);
    const login = clean(data.username).toLowerCase().slice(0, 80);
    await throttle(m, "login:" + client, 30, 10);
    await throttle(m, "account:" + await digest(login), 12, 10);
    const account = await m.one("SELECT * FROM accounts WHERE username=?", login);
    const candidate = typeof data.password === "string" ? data.password.slice(0, 161) : "";
    const verified = await passwordHash(candidate, account?.secret.split(":")[0] ?? "00000000000000000000000000000000");
    if (!account || !equal(account.secret, verified)) fail(401, "Identifiant ou mot de passe incorrect.");
    return openSession(m, request, account.id);
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const token = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) await m.run("DELETE FROM sessions WHERE token=?", await digest(token));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (method === "GET" && path === "/api/borne/reglages") {
    const closure = kioskClosure(clock);
    const [settings, state, gauge] = await Promise.all([kioskSettings(m),m.one(closure.sql,...closure.params),occupancy(m,clock)]);
    return json({ ...settings, ...gauge, open:!state.reason, reason:state.reason });
  }
  if (method === "GET" && path === "/api/planning") {
    const start = url.searchParams.get("week");
    if (!validDay(start) || weekday(start)!==1) fail(400,"Sélectionnez un lundi.");
    const closure=kioskClosure(clock);
    const [planned,gauge,state]=await Promise.all([weekPlanning(m,start),occupancy(m,clock),m.one(closure.sql,...closure.params)]);
    return json({ ...planned, ...gauge, open:!state.reason, reason:state.reason });
  }
  if (method === "GET" && path === "/api/borne/recherche") {
    const query = words(url.searchParams.get("q")?.slice(0, 90)).split(" ").filter(Boolean).slice(0, 8);
    if (query.join("").length < 3) return json({ results: [] });
    await throttle(m, "search:" + client, 140);
    const matching = query.map(() => "AND instr(s.search_name,?)>0").join(" ");
    const closure = kioskClosure(clock);
    const rows = await m.list(`${peopleSelect} WHERE s.active=1
      AND (${closure.sql})=''
      ${matching} ORDER BY s.last_name,s.first_name,c.name LIMIT 7`, ...closure.params,...query);
    return json({ results: rows.map(({ class_id, ...row }) => row) });
  }
  if (method === "POST" && path === "/api/borne/entree") {
    await throttle(m, "checkin:" + client, 90);
    const data = await payload(request);
    const byCode = Boolean(clean(data.code));
    const target = clean(byCode ? data.code : data.student_id).slice(0, 80);
    const person = await m.one(`${peopleSelect} WHERE s.active=1 AND s.${byCode ? "code" : "id"}=?`, byCode ? target.toUpperCase() : target);
    const closure = kioskClosure(clock);
    if (!person) {
      const {reason} = await m.one(closure.sql,...closure.params);
      if (reason) fail(409,reason);
      fail(404, "Élève introuvable. Vérifie ton code ou recherche ton nom.");
    }
    const day = today();
    const [inserted, status, existing, closed, seats] = await m.batch([
      m.stmt(`INSERT INTO visits (id,student_id,starts_at,expires_at,class_name)
        SELECT ?,?,?,? + CASE WHEN ?=1
          AND NOT EXISTS (SELECT 1 FROM kiosk_settings WHERE id=1 AND allow_second_hour=0)
          THEN ? ELSE 0 END,?
        WHERE EXISTS (SELECT 1 FROM students WHERE id=? AND active=1)
        AND (${closure.sql})=''
        AND NOT EXISTS (SELECT 1 FROM exclusions WHERE student_id=? AND revoked_at IS NULL AND until_day>=?)
        AND NOT EXISTS (SELECT 1 FROM visits WHERE student_id=? AND ended_at IS NULL AND expires_at>?) AND ${seatsSql}>0`,
      id(), person.id, clock, presenceDeadline(clock), Number(data.two_hours === true), HOUR, person.class_name,person.id,...closure.params,person.id,day,person.id,clock,clock),
      m.stmt("SELECT id FROM exclusions WHERE student_id=? AND revoked_at IS NULL AND until_day>=? LIMIT 1", person.id, day),
      m.stmt("SELECT expires_at FROM visits WHERE student_id=? AND ended_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1", person.id, clock),
      m.stmt(closure.sql,...closure.params),
      m.stmt(`SELECT ${seatsSql} AS places`,clock),
    ]);
    if (closed.results[0].reason) fail(409,closed.results[0].reason);
    if (status.results.length) fail(403, "L’entrée n’a pas pu être enregistrée. Adresse-toi à l’accueil du CDI.");
    if (!existing.results.length && seats.results[0].places===0) fail(409,"Le CDI est complet pour le moment.");
    if (!existing.results.length) fail(409, "L’entrée n’a pas pu être enregistrée. Réessaie.");
    return json({ first_name: person.first_name, expires_at: existing.results[0].expires_at, already: !changes(inserted) });
  }

  const me = await authenticate(m, request);
  if (!me) fail(401, "Connectez-vous pour accéder à cet espace.");
  const need = (...rights) => { if (!rights.some((right) => me.rights.includes(right))) fail(403, "Votre compte ne dispose pas de cet accès."); };
  const match = /^\/api\/gestion\/(eleves|classes|presences|exclusions|comptes)(?:\/([a-f0-9-]+))?$/.exec(path);
  const resource = match?.[1];
  const itemId = match?.[2];

  if (path === "/api/gestion/reglages" && ["GET", "PATCH"].includes(method)) {
    if (!me.admin) fail(403, "Seul un administrateur peut modifier les réglages de la borne.");
    if (method === "GET") return json(await kioskSettings(m));
    const data = await payload(request);
    if (typeof data.open !== "boolean" || typeof data.second_hour !== "boolean" || typeof data.message !== "string") fail(400, "Les réglages de la borne sont incomplets.");
    const message = clean(data.message);
    if (message.length > 180) fail(400, "Le message peut contenir jusqu’à 180 caractères.");
    const before=await kioskSettings(m);
    const capacity=data.capacity===undefined?before.capacity:data.capacity;
    const hideWeekend=data.hide_weekend===undefined?before.hide_weekend:data.hide_weekend;
    if ((capacity!==null && (!Number.isInteger(capacity) || capacity<1 || capacity>1000)) || typeof hideWeekend!=="boolean") fail(400,"Indiquez une capacité comprise entre 1 et 1 000 places ou laissez le champ vide.");
    const after={open:data.open,second_hour:data.second_hour,message,capacity,hide_weekend:hideWeekend};
    await m.batch([
      m.stmt(`INSERT INTO kiosk_settings (id,is_open,allow_second_hour,message,capacity,hide_weekend) VALUES (1,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET is_open=excluded.is_open,allow_second_hour=excluded.allow_second_hour,
        message=excluded.message,capacity=excluded.capacity,hide_weekend=excluded.hide_weekend`,
        Number(data.open),Number(data.second_hour),message,capacity,Number(hideWeekend)),
      audit(m,me,"horaires","Modification des réglages","Borne et planning",before,after),
    ]);
    return json(await kioskSettings(m));
  }

  if (path === "/api/gestion/horaires" && ["GET","PATCH"].includes(method)) {
    if (!me.admin) fail(403,"Seul un administrateur peut modifier les horaires d’ouverture.");
    if (method === "GET") return json(await openingHours(m));
    const {use_hours,hours} = await payload(request);
    if (typeof use_hours!=="boolean") fail(400,"Sélectionnez l’état des horaires automatiques.");
    const valid = normalizeHours(hours,fail);
    await saveOpeningHours(m,use_hours,valid,me,await openingHours(m));
    return json({ use_hours,hours:valid });
  }
  if (path === "/api/gestion/arrivees" && ["GET","POST"].includes(method)) {
    need("arrivees");
    if (method === "POST") return json(await groupArrival(m,await payload(request),clock,today(),fail));
    const classId = url.searchParams.get("class");
    if (!classId || !await m.one("SELECT id FROM classes WHERE id=?",classId)) fail(404,"Sélectionnez une classe existante.");
    return json({ rows:await classRoster(m,classId) });
  }
  if (path === "/api/gestion/statistiques" && method === "GET") {
    need("statistiques");
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!validDay(from) || !validDay(to) || from>to || to>parisClock(clock).day || Date.parse(to)-Date.parse(from)>=366*dayLength) {
      fail(400,"Choisissez une période de 366 jours maximum qui se termine aujourd’hui ou plus tôt.");
    }
    return json(await statistics(m,from,to,clock));
  }
  if (path === "/api/gestion/planning" && method === "GET") {
    need("planning");
    const start = url.searchParams.get("week");
    if (!validDay(start) || weekday(start)!==1) fail(400,"Sélectionnez un lundi.");
    return json(await weekPlanning(m,start,true));
  }
  if (path === "/api/gestion/planning/copier" && method === "POST") {
    need("planning");
    const {start} = await payload(request);
    if (!validDay(start) || weekday(start)!==1 || !validDay(shiftDay(start,13))) fail(400,"Sélectionnez une semaine valide.");
    return json(await duplicateWeek(m,start,me));
  }
  const planItem = path.match(/^\/api\/gestion\/planning\/([a-f0-9-]+)$/)?.[1];
  if ((path === "/api/gestion/planning" && method === "POST") || (planItem && ["PATCH","DELETE"].includes(method))) {
    need("planning");
    if (method === "DELETE") {
      const before=await m.one("SELECT day,start_min,end_min,title,kind FROM planning WHERE id=?",planItem);
      if (!before) fail(404,"Créneau introuvable.");
      const [removed]=await m.batch([m.stmt("DELETE FROM planning WHERE id=?",planItem),audit(m,me,"planning","Suppression du créneau",before.title,before,null,true)]);
      if (!changes(removed)) fail(404,"Créneau introuvable.");
      return json({ ok:true });
    }
    return json(await changeSlot(m,planItem,await payload(request),fail,label,me));
  }

  const groupItem=path.match(/^\/api\/gestion\/groupes\/([a-f0-9-]+)$/)?.[1];
  if (path==="/api/gestion/groupes" && method==="GET") {
    need("groupes","arrivees","planning");
    const rows=await groups(m);
    return json({ rows:me.rights.includes("groupes")?rows:rows.filter(row=>row.active) });
  }
  if ((path==="/api/gestion/groupes" && method==="POST") || (groupItem && ["GET","PATCH"].includes(method))) {
    need("groupes");
    if (method==="GET") return json({rows:await members(m,groupItem,fail)});
    return json(await changeGroup(m,me,groupItem,await payload(request),fail,label,normalize));
  }
  if (path==="/api/gestion/seances/effectif" && method==="GET") {
    need("arrivees");
    return json(await roster(m,url.searchParams.get("kind"),url.searchParams.get("id"),fail));
  }
  if (path==="/api/gestion/seances" && ["GET","POST"].includes(method)) {
    need("arrivees");
    if (method==="GET") return json({rows:await sessionsList(m,clock)});
    return json(await startSession(m,me,await payload(request),clock,fail,label));
  }
  const attendanceRoute=path.match(/^\/api\/gestion\/seances\/([a-f0-9-]+)(\/fin)?$/);
  if (attendanceRoute) {
    need("arrivees");
    const [,id,finish]=attendanceRoute;
    if (finish && method==="POST") return json(await finishSession(m,me,id,await payload(request),clock,fail));
    if (!finish && method==="GET") return json(await sessionDetail(m,id,clock,fail));
    if (!finish && method==="PATCH") return json(await changeCall(m,me,id,await payload(request),clock,fail));
  }
  if (path === "/api/gestion/sauvegarde" && ["GET", "POST"].includes(method)) {
    if (!me.admin) fail(403, "Les sauvegardes sont réservées aux administrateurs.");
    if (method === "GET") {
      const backup = await exportBackup(m, clock, fail);
      return jsonResponse(backup, 200, { "Content-Disposition": `attachment; filename="Sauvegarde-CDI-${parisClock(clock).day}.json"` });
    }
    const { backup, token } = await payload(request, maxBackupBytes + 1024);
    const summary = inspectBackup(backup, fail);
    const serialized = JSON.stringify(backup);
    if (encoder.encode(serialized).byteLength > maxBackupBytes) fail(413, "Le fichier est trop volumineux.");
    const fingerprint = await digest(serialized);
    if (token === undefined) return json({ ...summary, token:fingerprint });
    if (!equal(token, fingerprint)) fail(409, "Analysez à nouveau le fichier avant de confirmer la restauration.");
    await restoreBackup(m, me, backup, summary, fail);
    return json(summary);
  }
  if (path==="/api/gestion/journal" && method==="GET") {
    if (!me.admin) fail(403,"Le journal est réservé aux administrateurs.");
    const area=url.searchParams.get("area")??"";
    const before=Number(url.searchParams.get("before")??(clock+1));
    if (!Number.isSafeInteger(before) || before<0 || before>clock+1000) fail(400,"Page de journal invalide.");
    return json(await auditRows(m,area,before));
  }
  if (path==="/api/gestion/annees" && ["GET","POST"].includes(method)) {
    if (!me.admin) fail(403,"Le passage d’année est réservé aux administrateurs.");
    if (method==="GET") return json(await years(m,today()));
    return json(await rollover(m,me,await payload(request),clock,today(),{fail,studentData,normalize,className,digest,barcode}));
  }
  const yearItem=path.match(/^\/api\/gestion\/annees\/(\d{4}-\d{4})$/)?.[1];
  if (yearItem && method==="GET") {
    if (!me.admin) fail(403,"L’archive est réservée aux administrateurs.");
    return json({rows:await archiveRows(m,yearItem,fail)});
  }

  if (path === "/api/gestion/import" && method === "POST") {
    need("import");
    return json(await importStudents(m, await payload(request)));
  }
  if (resource === "presences") {
    if (method === "GET" && !itemId) {
      need("presence", "sorties", "arrivees");
      const rows = await m.list(`SELECT v.id,v.student_id,v.starts_at,v.expires_at,v.source,s.first_name,s.last_name,c.name AS class_name
        FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.ended_at IS NULL AND v.expires_at>? ORDER BY v.expires_at,s.last_name`, clock);
      return json({ rows, now: clock, ...await occupancy(m,clock) });
    }
    if (method === "PATCH" && itemId) {
      need("sorties");
      const { minutes, expires_at } = await payload(request);
      if (![15, 30].includes(minutes) || !Number.isSafeInteger(expires_at)) fail(400, "Choisissez une prolongation de 15 ou 30 minutes.");
      const visit = await m.one(`SELECT v.expires_at,v.ended_at,s.first_name,s.last_name FROM visits v
        JOIN students s ON s.id=v.student_id WHERE v.id=?`, itemId);
      if (!visit || visit.ended_at !== null || visit.expires_at <= clock) fail(409, "Cette présence est terminée.");
      if (visit.expires_at !== expires_at) fail(409, "Le départ prévu a changé. Fermez cette fenêtre et ouvrez à nouveau la prolongation.");
      const updated = expires_at + minutes * 60_000;
      const [result] = await m.batch([
        m.stmt("UPDATE visits SET expires_at=? WHERE id=? AND ended_at IS NULL AND expires_at=? AND expires_at>?", updated, itemId, expires_at, Date.now()),
        audit(m, me, "presences", "Prolongation de présence", visit.first_name + " " + visit.last_name, {expiration:expires_at}, {expiration:updated}, true),
      ]);
      if (!changes(result)) fail(409, "La présence a changé. Fermez cette fenêtre et ouvrez à nouveau la prolongation.");
      return json({ expires_at: updated });
    }
    if (method === "DELETE" && itemId) {
      need("sorties");
      await m.run("UPDATE visits SET ended_at=? WHERE id=? AND ended_at IS NULL AND expires_at>?", clock, itemId, clock);
      return json({ ok: true });
    }
  }
  if (resource === "classes") {
    if (method === "GET" && !itemId) {
      need("classes", "eleves", "badges", "import", "presence", "sorties", "arrivees", "planning");
      return json({ rows: await m.list(`SELECT c.id,c.name,(SELECT count(*) FROM students s WHERE s.class_id=c.id AND s.active=1) AS total
        FROM classes c ORDER BY c.normalized`) });
    }
    if (method === "POST" || method === "PATCH") {
      need("classes");
      const data = await payload(request);
      const name = className(data.name);
      const normalized = normalize(name);
      if (await m.one("SELECT id FROM classes WHERE normalized=? AND id<>?", normalized, itemId ?? "")) fail(409, "Cette classe existe déjà.");
      if (method === "POST" && !itemId) await m.run("INSERT INTO classes VALUES (?,?,?)", id(), name, normalized);
      else if (method === "PATCH" && itemId) {
        if (!changes(await m.run("UPDATE classes SET name=?,normalized=? WHERE id=?", name, normalized, itemId))) fail(404, "Classe introuvable.");
      } else fail(405, "Action indisponible.");
      return json({ ok: true });
    }
    if (method === "DELETE" && itemId) {
      need("classes");
      const deleted = await m.run("DELETE FROM classes WHERE id=? AND NOT EXISTS (SELECT 1 FROM students WHERE class_id=?)", itemId, itemId);
      if (!changes(deleted)) fail(409, "Déplacez les élèves, y compris les fiches retirées, avant de supprimer cette classe.");
      return json({ ok: true });
    }
  }
  if (resource === "eleves") {
    if (method === "GET" && !itemId) {
      const forBadges = url.searchParams.get("badges") === "1";
      need(...(forBadges ? ["badges"] : ["eleves", "exclusions", "groupes"]));
      const classId = url.searchParams.get("class") ?? "";
      const active = !forBadges && me.rights.includes("eleves") && url.searchParams.get("archived") === "1" ? 0 : 1;
      const search = words(url.searchParams.get("q")?.slice(0, 90)).split(" ").filter(Boolean).slice(0, 8);
      const query = search.map(() => "AND instr(s.search_name,?)>0").join(" ");
      const extra = forBadges || me.rights.includes("badges") ? ",s.code" : "";
      const external = !forBadges && me.rights.includes("eleves") ? ",s.external_id" : "";
      return json({ rows: await m.list(`SELECT ${personColumns}${extra}${external} FROM students s JOIN classes c ON c.id=s.class_id
        WHERE s.active=? AND (?='' OR s.class_id=?) ${query} ORDER BY s.last_name,s.first_name,c.name LIMIT 5000`, active, classId, classId, ...search) });
    }
    if ((method === "POST" && !itemId) || (method === "PATCH" && itemId)) {
      need("eleves");
      return json(await saveStudent(m, await payload(request), itemId));
    }
    if (method === "DELETE" && itemId) {
      need("eleves");
      await m.batch([
        m.stmt("UPDATE students SET active=0 WHERE id=?", itemId),
        m.stmt("UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?", clock, itemId, clock),
      ]);
      return json({ ok: true });
    }
  }
  if (resource === "exclusions") {
    need("exclusions");
    if (method === "GET" && !itemId) return json({ rows: await m.list(`SELECT e.*,s.first_name,s.last_name,c.name AS class_name
      FROM exclusions e JOIN students s ON s.id=e.student_id JOIN classes c ON s.class_id=c.id ORDER BY e.created_at DESC LIMIT 500`), today: today() });
    if (method === "POST" && !itemId) {
      const data = await payload(request);
      const reason = label(data.reason, "Le motif", 500);
      const day = clean(data.until_day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today() || day > "2199-12-31" || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day) fail(400, "Choisissez une date de fin valide.");
      const studentId = label(data.student_id, "L’élève");
      if (!await m.one("SELECT id FROM students WHERE id=? AND active=1", studentId)) fail(404, "Élève introuvable.");
      await m.batch([
        m.stmt("INSERT INTO exclusions VALUES (?,?,?,?,?,?,NULL)", id(), studentId, reason, day, clock, me.name),
        m.stmt("UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?", clock, studentId, clock),
      ]);
      return json({ ok: true });
    }
    if (method === "DELETE" && itemId) {
      await m.run("UPDATE exclusions SET revoked_at=? WHERE id=? AND revoked_at IS NULL", clock, itemId);
      return json({ ok: true });
    }
  }
  if (resource === "comptes") {
    need("comptes");
    if (method === "GET" && !itemId) return json({ rows: (await m.list("SELECT * FROM accounts ORDER BY admin DESC,name")).map(publicAccount) });
    const target = itemId ? await m.one("SELECT * FROM accounts WHERE id=?", itemId) : null;
    if (itemId && !target) fail(404, "Compte introuvable.");
    if (target && !me.admin && (target.admin || publicAccount(target).rights.some((right) => !me.rights.includes(right)))) fail(403, "Ce compte ne peut pas être modifié avec vos droits.");
    if (method === "DELETE" && itemId) {
      if (target.id === me.id) fail(409, "Votre compte ne peut pas être supprimé depuis votre session.");
      const deleted = await m.run("DELETE FROM accounts WHERE id=? AND (admin=0 OR (SELECT count(*) FROM accounts WHERE admin=1)>1)", target.id);
      if (!changes(deleted)) fail(409, "Au moins un compte administrateur doit rester actif.");
      return json({ ok: true });
    }
    if ((method === "POST" && !itemId) || (method === "PATCH" && itemId)) {
      const data = await payload(request);
      const login = username(data.username);
      const name = label(data.name, "Le nom d’affichage");
      const admin = data.admin === true;
      if (admin && !me.admin) fail(403, "Seul un administrateur peut accorder l’accès complet.");
      if (target?.id === me.id && (Boolean(target.admin) !== admin || !admin)) fail(409, "Vos propres droits sont protégés.");
      const rights = RIGHTS.filter((right) => Array.isArray(data.rights) && data.rights.includes(right));
      if (!admin && !rights.length) fail(400, "Sélectionnez au moins un droit.");
      if (!me.admin && rights.some((right) => !me.rights.includes(right))) fail(403, "Vous ne pouvez accorder que vos propres droits.");
      if (await m.one("SELECT id FROM accounts WHERE username=? AND id<>?", login, itemId ?? "")) fail(409, "Cet identifiant est déjà utilisé.");
      const secret = !target || data.password ? await passwordHash(newPassword(data.password)) : target.secret;
      if (target) {
        const actions = [m.stmt(`UPDATE accounts SET username=?,name=?,secret=?,permissions=?,admin=?
          WHERE id=? AND (admin=0 OR ?=1 OR (SELECT count(*) FROM accounts WHERE admin=1)>1)`,
          login, name, secret, JSON.stringify(rights), Number(admin), target.id, Number(admin))];
        if (secret !== target.secret) actions.push(m.stmt("DELETE FROM sessions WHERE account_id=?", target.id));
        if (!changes((await m.batch(actions))[0])) fail(409, "Au moins un compte administrateur doit rester actif.");
        if (secret !== target.secret && me.id === target.id) return openSession(m, request, target.id);
      } else await m.run("INSERT INTO accounts VALUES (?,?,?,?,?,?)", id(), login, name, secret, JSON.stringify(rights), Number(admin));
      return json({ ok: true });
    }
  }
  fail(404, "Action introuvable.");
}
export async function api(request, env, options = {}) {
  try { return await dispatch(request, env, options); }
  catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    if (/UNIQUE constraint failed/i.test(error.message)) return json({ error: "Cette valeur est déjà utilisée." }, 409);
    console.error("CDI API", new URL(request.url).pathname, error);
    return json({ error: "Le service est temporairement indisponible. Réessayez dans un instant." }, 500);
  }
}
