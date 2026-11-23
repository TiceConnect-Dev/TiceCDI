import { changePrivacy, checkedPrivacyState, decryptBackup, encryptBackup, maintain, maxEnvelopeBytes, noticeData,
  privacySettings, privateStatistics, publicPlanning, recoveryState, recoveryStatements, scrubLegacy, studentFile, taskStatement } from "./privacy.mjs";
import { audit, auditRows } from "./audit.mjs";
import { agentSummary, consumeSecondFactor, securityApi } from "./security.mjs";
import { connectionApi, connectionSettings, ssoApi, ssoPublic } from "./connection.mjs";
import { checkDisplay, displaySettings, kioskToday } from "./display.mjs";
import { cardCode, deviceExpiry, deviceSettings, devicesApi, kioskLabel, rankMatches, searchTokens, touchDevice } from "./devices.mjs";
import { exportBackup, inspectBackup, maxBackupBytes, restoreBackup } from "./backup.mjs";
import { occupancy, seatsSql } from "./capacity.mjs";
import { changeCall, changeGroup, finishSession, groups, members, roster, sessionDetail, sessionsList, startSession } from "./school.mjs";
import { archiveRows, rollover, years } from "./school-year.mjs";
import { changeSlot, duplicateWeek, hourLength as HOUR, kioskClosure, normalizeHours, openingHours, parisClock, parisMidnight, presenceDeadline, saveOpeningHours, shiftDay, validDay, weekday, weekPlanning } from "./calendar.mjs";
import { classRoster, groupArrival } from "./operations.mjs";
import { capacityAlert, excludedAttempt, fullRefused, recentEvents } from "./events.mjs";

// Droits : « gérer » (clé simple) ou « consulter » (suffixe _voir) par rubrique, plus des actions ponctuelles.
export const RIGHTS = ["presence", "sorties", "exclusions", "exclusions_voir", "eleves", "eleves_voir", "classes", "classes_voir", "import", "badges", "comptes", "arrivees", "seances_voir", "planning", "planning_voir", "statistiques", "groupes", "groupes_voir", "borne", "reglages", "reglages_voir", "journal", "export_planning", "export_appel", "export_statistiques", "export_dossiers", "sauvegarde", "restaurer", "dossiers_voir", "donnees", "effacer", "comptes_voir"];
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
// Hachage des mots de passe : PBKDF2-SHA256 à 600 000 itérations (recommandation OWASP).
// Format « pbkdf2$itérations$sel$empreinte ». L’ancien format « sel:empreinte » (100 000 itérations)
// reste reconnu puis est converti automatiquement à la connexion suivante.
const PASSWORD_ITERATIONS = 600000;
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations }, key, 256);
  return hex(new Uint8Array(bits));
}
async function passwordHash(password) {
  const salt = random(16);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PASSWORD_ITERATIONS)}`;
}
function parseSecret(stored) {
  if (typeof stored !== "string") return null;
  const legacy = stored.match(/^([a-f0-9]{32}):([a-f0-9]{64})$/);
  if (legacy) return { iterations: 100000, salt: legacy[1], hash: legacy[2] };
  const current = stored.match(/^pbkdf2\$(\d{6,7})\$([a-f0-9]{32})\$([a-f0-9]{64})$/);
  const iterations = Number(current?.[1]);
  if (!current || iterations < 100000 || iterations > 5000000) return null;
  return { iterations, salt: current[2], hash: current[3] };
}
async function verifyPassword(password, stored) {
  const parsed = parseSecret(stored);
  const params = parsed ?? { iterations: PASSWORD_ITERATIONS, salt: "0".repeat(32), hash: "" };
  const ok = equal(await pbkdf2(password, params.salt, params.iterations), params.hash) && Boolean(parsed);
  return { ok, upgrade: ok && params.iterations < PASSWORD_ITERATIONS };
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
function cookie(request, token, maxAge, name = "cdi_session", sameSite = "Strict") {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
}
function withCookies(response, cookies) {
  for (const value of cookies) response.headers.append("Set-Cookie", value);
  return response;
}
export function model(db) {
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
// Motif de présence : texte court facultatif (60 caractères au plus).
function visitReason(value, fail) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") fail(400, "Indiquez un motif valide.");
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length > 60) fail(400, "Le motif peut contenir jusqu’à 60 caractères.");
  return reason || null;
}
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
function sessionCookie(request) {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null;
}
async function authenticate(m, request) {
  const token = sessionCookie(request);
  if (!token) return null;
  const key = await digest(token);
  const now = Date.now();
  const row = await m.one(`SELECT a.*,t.last_seen AS session_seen,s.idle_minutes,s.mfa_policy,
    EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS has_mfa
    FROM sessions t JOIN accounts a ON a.id=t.account_id LEFT JOIN security_settings s ON s.id=1
    WHERE t.token=? AND t.expires_at>?`, key, now);
  if (!row) return null;
  // Déconnexion après inactivité : les actualisations automatiques (en-tête X-CDI-Background) ne comptent pas comme activité.
  if (row.idle_minutes > 0 && row.session_seen > 0 && row.session_seen < now - row.idle_minutes * 60_000) {
    await m.run("DELETE FROM sessions WHERE token=?", key);
    return null;
  }
  if (request.headers.get("x-cdi-background") !== "1" && row.session_seen < now - 60_000) await m.run("UPDATE sessions SET last_seen=? WHERE token=?", now, key);
  const mfa = Boolean(row.has_mfa);
  return { ...publicAccount(row), mfa, mfa_missing:!mfa && (row.mfa_policy === "all" || (row.mfa_policy === "admins" && row.admin === 1)) };
}
async function openSession(m, request, accountId, client = "") {
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookieFor(m, request, accountId, client) });
}
async function sessionCookieFor(m, request, accountId, client = "") {
  const now = Date.now();
  const token = random(32);
  await m.batch([
    m.stmt("DELETE FROM sessions WHERE expires_at<=?", now),
    m.stmt("INSERT INTO sessions (token,account_id,expires_at,created_at,last_seen,agent,address) VALUES (?,?,?,?,?,?,?)",
      await digest(token), accountId, now + 12 * HOUR, now, now, agentSummary(request.headers.get("user-agent") ?? ""), String(client).slice(0, 64)),
  ]);
  return cookie(request, token, 12 * 3600);
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
    return json({ user, setup: !account, keyRequired: !setupAllowed, demoAllowed: options.hosted, sso: ssoPublic(await connectionSettings(m)) });
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
    return openSession(m, request, accountId, client);
  }
  if (method === "POST" && path === "/api/auth/login") {
    const data = await payload(request);
    const login = clean(data.username).toLowerCase().slice(0, 80);
    await throttle(m, "login:" + client, 30, 10);
    await throttle(m, "account:" + await digest(login), 12, 10);
    const account = await m.one("SELECT * FROM accounts WHERE username=?", login);
    const candidate = typeof data.password === "string" ? data.password.slice(0, 161) : "";
    const verified = await verifyPassword(candidate, account?.secret);
    const trace = { poste: client, navigateur: agentSummary(request.headers.get("user-agent") ?? "") };
    if (!account || !verified.ok) {
      await m.batch([audit(m, { name: account?.name ?? "Identifiant inconnu" }, "securite", "Échec de connexion", account?.username ?? "Connexion", null, trace)]);
      fail(401, "Identifiant ou mot de passe incorrect.");
    }
    const mfa = await m.one("SELECT * FROM account_mfa WHERE account_id=? AND secret IS NOT NULL", account.id);
    if (mfa) {
      if (!clean(data.code)) return json({ mfa: true });
      await throttle(m, "mfa:" + account.id, 6, 10);
      const factor = await consumeSecondFactor(m, account.id, mfa, data.code, clock);
      if (!factor) {
        await m.batch([audit(m, account, "securite", "Échec de la double authentification", account.username, null, trace)]);
        fail(401, "Code de vérification incorrect.");
      }
      if (factor === "secours") await m.batch([audit(m, account, "securite", "Connexion avec un code de secours", account.username, null, trace)]);
    }
    if (verified.upgrade) await m.run("UPDATE accounts SET secret=? WHERE id=? AND secret=?", await passwordHash(candidate), account.id, account.secret);
    return openSession(m, request, account.id, client);
  }
  if (path.startsWith("/api/auth/sso/")) {
    const trace = { poste: client, navigateur: agentSummary(request.headers.get("user-agent") ?? "") };
    const page = (target, query = {}) => target + (Object.keys(query).length ? "?" + new URLSearchParams(query) : "");
    const links = { page, callback:(state) => url.origin + "/api/auth/sso/callback" + (state ? "?state=" + state : "") };
    const cookieHeader = (name, value, maxAge, sameSite) => cookie(request, value, maxAge, name, sameSite);
    const finish = async (account) => {
      const redirect = (location, cookies) => withCookies(new Response(null, { status:303, headers:{ Location:location, "Cache-Control":"no-store" } }), [cookieHeader("cdi_sso", "", 0, "Lax"), ...cookies]);
      if (await m.one("SELECT 1 FROM account_mfa WHERE account_id=? AND secret IS NOT NULL", account.id)) {
        const challenge = random(32);
        await m.batch([
          m.stmt("DELETE FROM login_challenges WHERE expires_at<=?", clock),
          m.stmt("INSERT INTO login_challenges VALUES (?,?,?)", await digest(challenge), account.id, clock + 5 * 60_000),
        ]);
        return redirect(page("/connexion", { etape:"code" }), [cookie(request, challenge, 300, "cdi_challenge")]);
      }
      return redirect("/gestion", [await sessionCookieFor(m, request, account.id, client)]);
    };
    const handled = await ssoApi({ m, request, path, method, clock, fail, links, finish, audit, trace, cookieHeader });
    if (handled) return handled;
  }
  if (method === "POST" && path === "/api/auth/challenge") {
    const token = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_challenge=([a-f0-9]{64})(?:;|$)/)?.[1];
    const pending = token ? await m.one("SELECT * FROM login_challenges WHERE token=? AND expires_at>?", await digest(token), clock) : null;
    if (!pending) fail(401, "La vérification a expiré. Reconnectez-vous.");
    const account = await m.one("SELECT * FROM accounts WHERE id=?", pending.account_id);
    const mfa = await m.one("SELECT * FROM account_mfa WHERE account_id=? AND secret IS NOT NULL", pending.account_id);
    const data = await payload(request);
    await throttle(m, "mfa:" + account.id, 6, 10);
    if (!mfa || !await consumeSecondFactor(m, account.id, mfa, data.code, clock)) {
      await m.batch([audit(m, account, "securite", "Échec de la double authentification", account.username, null, { poste: client, navigateur: agentSummary(request.headers.get("user-agent") ?? "") })]);
      fail(401, "Code de vérification incorrect.");
    }
    await m.run("DELETE FROM login_challenges WHERE token=?", pending.token);
    return withCookies(json({ ok: true }), [await sessionCookieFor(m, request, account.id, client), cookie(request, "", 0, "cdi_challenge")]);
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const token = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) await m.run("DELETE FROM sessions WHERE token=?", await digest(token));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (method==="GET" && path==="/api/notice") return json(noticeData(await privacySettings(m)));
  if (method==="GET" && path==="/api/planning") {
    if (!(await privacySettings(m)).public_planning) fail(403,"L’écran de planning sans connexion est désactivé.");
    const start=url.searchParams.get("week");
    if (!validDay(start) || weekday(start)!==1) fail(400,"Sélectionnez un lundi.");
    const planned=await weekPlanning(m,start);
    // Occupation en temps réel pour l’écran public : uniquement des nombres agrégés.
    return json({...planned,rows:publicPlanning(planned.rows),occupancy:await occupancy(m,clock)});
  }
  if (path.startsWith("/api/borne/")) {
    const token=request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_device=([a-f0-9]{64})(?:;|$)/)?.[1];
    const key=token ? await digest(token) : "";
    const device=await m.one(`SELECT k.token,k.expires_at,k.last_seen FROM kiosk_devices k JOIN accounts a ON a.id=k.account_id
      WHERE k.token=? AND k.expires_at>? AND (a.admin=1 OR EXISTS(SELECT 1 FROM json_each(a.permissions) WHERE value='borne'))`,key,clock);
    if (method==="GET" && path==="/api/borne/reglages") {
      if (!device) return json({activated:false});
      // Renouvellement automatique : une borne utilisée régulièrement reste activée.
      const renewed=await touchDevice(m,device,clock);
      const closure=kioskClosure(clock);
      const [settings,state,gauge,display,todayPlan]=await Promise.all([kioskSettings(m),m.one(closure.sql,...closure.params),occupancy(m,clock),displaySettings(m),kioskToday(m,clock)]);
      return json({...settings,...gauge,activated:true,open:!state.reason,reason:state.reason,name_search:(await deviceSettings(m)).name_search,display,today:todayPlan},200,
        renewed ? {"Set-Cookie":cookie(request,token,Math.floor((renewed-clock)/1000),"cdi_device")} : {});
    }
    if (!device) fail(403,"Ce poste doit être activé par le personnel.");
    if (method==="POST" && path==="/api/borne/recherche") {
      if (!(await deviceSettings(m)).name_search) fail(403,"La recherche par nom est désactivée sur cette borne.");
      await throttle(m,"search:"+key,40);
      const tokens=searchTokens((await payload(request)).q,words);
      if (!tokens.length) return json({rows:[],short:true});
      const columns="SELECT s.id,s.first_name,s.last_name,s.search_name,c.name AS class_name,c.normalized AS class_key FROM students s JOIN classes c ON c.id=s.class_id WHERE s.active=1";
      let found=rankMatches(await m.list(`${columns} ${tokens.map(()=>"AND (s.search_name LIKE ? OR replace(c.normalized,' ','') LIKE ?)").join(" ")} LIMIT 200`,
        ...tokens.flatMap(token=>["%"+token+"%",token+"%"])),tokens);
      // Aucune correspondance exacte : tolérance d’une ou deux fautes de frappe.
      let fuzzy=false;
      if (!found.length && tokens.some(token=>token.length>=3)) { found=rankMatches(await m.list(columns+" LIMIT 5000"),tokens,true); fuzzy=found.length>0; }
      const rows=found.slice(0,6).map(row=>({ref:random(16),label:kioskLabel(row),class_name:row.class_name,student_id:row.id}));
      await m.batch([m.stmt("DELETE FROM kiosk_refs WHERE expires_at<=?",clock),
        ...rows.map(row=>m.stmt("INSERT INTO kiosk_refs VALUES (?,?,?,?)",row.ref,row.student_id,key,clock+180_000))]);
      return json({rows:rows.map(({student_id,...row})=>row),more:found.length>6,fuzzy});
    }
    if (method!=="POST" || !["/api/borne/entree","/api/borne/sortie","/api/borne/auto"].includes(path)) fail(404,"Action introuvable.");
    await throttle(m,"checkin:"+key,90);
    const data=await payload(request);
    // Élève choisi dans la recherche par nom : la sélection temporaire remplace le code de la carte.
    if (typeof data.ref==="string" && /^[a-f0-9]{32}$/.test(data.ref)) {
      const picked=await m.one("SELECT s.code FROM kiosk_refs r JOIN students s ON s.id=r.student_id WHERE r.ref=? AND r.device=? AND r.expires_at>?",data.ref,key,clock);
      if (!picked) fail(410,"La sélection a expiré. Recherche à nouveau ton nom.");
      data.code=picked.code;
    }
    const code=cardCode(typeof data.code==="string" ? data.code.slice(0,80) : "");
    if (!code) fail(400,"Scanne ou saisis le code de ta carte CDI.");
    const person=await m.one(`SELECT s.id,s.first_name,s.last_name,c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id
      WHERE s.active=1 AND s.code=?`,code);
    // Carte scannée : sortie si l’élève est déjà présent, entrée sinon.
    const present=path.endsWith("/auto") && person && await m.one("SELECT 1 AS yes FROM visits WHERE student_id=? AND ended_at IS NULL AND expires_at>?",person.id,clock);
    if (path.endsWith("/sortie") || present) {
      if (person) await m.run("UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?",clock,person.id,clock);
      return json({ok:true,direction:"sortie"});
    }
    const closure = kioskClosure(clock);
    if (!person) {
      const {reason} = await m.one(closure.sql,...closure.params);
      if (reason) fail(409,reason);
      fail(404, "Carte introuvable. Vérifie le code ou adresse-toi au personnel.");
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
    if (status.results.length) { await excludedAttempt(clock,m,person); fail(403, "L’entrée n’a pas pu être enregistrée. Adresse-toi à l’accueil du CDI."); }
    if (!existing.results.length && seats.results[0].places===0) { await fullRefused(clock,m); fail(409,"Le CDI est complet pour le moment."); }
    if (!existing.results.length) fail(409, "L’entrée n’a pas pu être enregistrée. Réessaie.");
    if (changes(inserted)) await capacityAlert(m,clock);
    return json({ expires_at: existing.results[0].expires_at, already: !changes(inserted) });
  }

  const me = await authenticate(m, request);
  if (!me) fail(401, "Connectez-vous pour accéder à cet espace.");
  const need = (...rights) => { if (!rights.some((right) => me.rights.includes(right))) fail(403, "Votre compte ne dispose pas de cet accès."); };
  const token = sessionCookie(request);
  if (me.mfa_missing && !path.startsWith("/api/gestion/securite")) fail(403, "Votre établissement exige la double authentification : activez-la dans « Sécurité du compte ».");
  const configured = await connectionApi({ m, request, me, path, method, clock, json, fail, payload, audit,
    callback: url.origin + "/api/auth/sso/callback" });
  if (configured) return configured;
  const deviceToken = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_device=([a-f0-9]{64})(?:;|$)/)?.[1];
  const devices = await devicesApi({ m, request, me, path, method, clock, json, fail, payload, audit,
    currentDevice: deviceToken ? (await digest(deviceToken)).slice(0, 16) : "" });
  if (devices) return devices;
  const secured = await securityApi({ m, request, me, path, method, clock, json, fail, payload, audit, verifyPassword, cookie,
    currentToken: token ? await digest(token) : "" });
  if (secured) return secured;
  if (path==="/api/gestion/borne/activation" && method==="POST") {
    need("borne");
    const data=request.headers.get("content-type")?.startsWith("application/json") ? await payload(request) : {};
    const name=clean(data.label).slice(0,60);
    const token=random(32);
    const expires=deviceExpiry(await deviceSettings(m),clock);
    const maxAge=Math.floor((expires-clock)/1000);
    await m.batch([
      m.stmt("INSERT INTO kiosk_devices (token,account_id,expires_at,label,created_at,last_seen,agent,address) VALUES (?,?,?,?,?,?,?,?)",
        await digest(token),me.id,expires,name,clock,clock,agentSummary(request.headers.get("user-agent") ?? ""),String(client).slice(0,64)),
      audit(m,me,"confidentialite","Activation d’un poste",name||"Borne",null,null),
    ]);
    return json({ok:true},200,{"Set-Cookie":cookie(request,token,maxAge,"cdi_device")});
  }
  if (path==="/api/gestion/borne/activation" && method==="DELETE") {
    need("borne");
    await m.batch([
      me.admin ? m.stmt("DELETE FROM kiosk_devices") : m.stmt("DELETE FROM kiosk_devices WHERE account_id=?",me.id),
      audit(m,me,"confidentialite","Révocation des activations","Borne",null,null),
    ]);
    return json({ok:true});
  }
  if (path==="/api/gestion/confidentialite" && ["GET","PATCH"].includes(method)) {
    if (!me.admin) fail(403,"Cette rubrique est réservée aux administrateurs.");
    if (method==="PATCH") return json(await changePrivacy(m,me,await payload(request),fail));
    return json({...await privacySettings(m),...await m.one("SELECT last_success FROM privacy_state WHERE id=1")});
  }
  if (path==="/api/gestion/confidentialite/purge" && method==="POST") {
    if (!me.admin) fail(403,"Cette rubrique est réservée aux administrateurs.");
    return json(await maintain(m,clock));
  }
  if (path==="/api/gestion/dossier/recherche" && method==="POST") {
    need("dossiers_voir","donnees");
    const input=clean((await payload(request)).q).slice(0,90), query=words(input);
    if (query.length<3) return json({rows:[]});
    const tokens=query.split(" ").slice(0,8);
    const filter=tokens.map(()=> "instr(s.search_name,?)>0").join(" AND ");
    return json({rows:await m.list(`${peopleSelect} WHERE (${filter}) OR s.external_id=? ORDER BY s.last_name,s.first_name LIMIT 20`,...tokens,input)});
  }
  const individual=path.match(/^\/api\/gestion\/dossier\/([a-f0-9-]+)(\/export)?$/);
  if (individual) {
    need("dossiers_voir","donnees");
    const [,student,file]=individual;
    if (file && method==="GET") {
      need("export_dossiers");
      const data=await studentFile(m,student,fail);
      await m.batch([audit(m,me,"confidentialite","Export d’un dossier","Dossier individuel",null,null)]);
      return json(data,200,{"Content-Disposition":'attachment; filename="Dossier-eleve.json"'});
    }
    if (!file && method==="GET") return json(await studentFile(m,student,fail));
    if (!file && method==="PATCH") {
      need("donnees");
      const result=await saveStudent(m,await payload(request),student);
      await m.batch([
        m.stmt("UPDATE attendance_members SET first_name=(SELECT first_name FROM students WHERE id=?),last_name=(SELECT last_name FROM students WHERE id=?) WHERE student_id=?",student,student,student),
        m.stmt("UPDATE school_year_members SET first_name=(SELECT first_name FROM students WHERE id=?),last_name=(SELECT last_name FROM students WHERE id=?) WHERE student_id=?",student,student,student),
        audit(m,me,"confidentialite","Rectification d’un dossier","Dossier individuel",null,null),
      ]);
      return json(result);
    }
    if (!file && method==="DELETE") {
      need("effacer");
      if ((await payload(request)).confirmation!=="EFFACER") fail(400,"Confirmez l’effacement.");
      await studentFile(m,student,fail);
      await m.batch([taskStatement(m,await privacySettings(m),clock,"erase",student),
        audit(m,me,"confidentialite","Effacement validé","Dossier individuel",null,null)]);
      return json({ok:true});
    }
  }
  if (path==="/api/gestion/export" && method==="POST") {
    const {type}=await payload(request);
    // Chaque export a son propre droit, en plus du droit de consulter la rubrique ; il n’ouvre jamais les sauvegardes.
    const permissions={planning:["export_planning",["planning","planning_voir"]],appel:["export_appel",["arrivees","seances_voir"]],
      statistiques:["export_statistiques",["statistiques"]],badges:["badges",["badges"]]};
    if (type==="archives") { if (!me.admin) fail(403,"Votre compte ne dispose pas de cet accès."); }
    else if (!Object.hasOwn(permissions,type)) fail(400,"Export inconnu.");
    else { need(permissions[type][0]); need(...permissions[type][1]); }
    await m.batch([audit(m,me,"confidentialite","Export",type,null,null)]);
    return json({ok:true});
  }
  const match = /^\/api\/gestion\/(eleves|classes|presences|exclusions|comptes)(?:\/([a-f0-9-]+))?$/.exec(path);
  const resource = match?.[1];
  const itemId = match?.[2];

  if (path === "/api/gestion/reglages" && ["GET", "PATCH"].includes(method)) {
    need(...(method === "GET" ? ["reglages", "reglages_voir"] : ["reglages"]));
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

  if (path === "/api/gestion/borne/affichage" && ["GET", "PATCH"].includes(method)) {
    need(...(method === "GET" ? ["reglages", "reglages_voir"] : ["reglages"]));
    if (method === "GET") return json(await displaySettings(m));
    const before=await displaySettings(m);
    const after=checkDisplay({...before,...(await payload(request))},fail);
    await m.batch([
      m.stmt("INSERT INTO kiosk_display (id,settings) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings",JSON.stringify(after)),
      audit(m,me,"horaires","Modification de l’affichage de la borne","Borne",before,after),
    ]);
    return json(after);
  }

  if (path === "/api/gestion/horaires" && ["GET","PATCH"].includes(method)) {
    need(...(method === "GET" ? ["reglages", "reglages_voir"] : ["reglages"]));
    if (method === "GET") return json(await openingHours(m));
    const {use_hours,hours} = await payload(request);
    if (typeof use_hours!=="boolean") fail(400,"Sélectionnez l’état des horaires automatiques.");
    const valid = normalizeHours(hours,fail);
    await saveOpeningHours(m,use_hours,valid,me,await openingHours(m));
    return json({ use_hours,hours:valid });
  }
  if (path === "/api/gestion/arrivees" && ["GET","POST"].includes(method)) {
    need("arrivees");
    if (method === "POST") { const result=await groupArrival(m,await payload(request),clock,today(),fail); if (result.added) await capacityAlert(m,clock); return json(result); }
    const classId = url.searchParams.get("class");
    if (!classId || !await m.one("SELECT id FROM classes WHERE id=?",classId)) fail(404,"Sélectionnez une classe existante.");
    return json({ rows:await classRoster(m,classId) });
  }
  if (path==="/api/gestion/statistiques" && method==="GET") {
    need("statistiques");
    return json(await privateStatistics(m,url.searchParams.get("from"),url.searchParams.get("to"),clock,fail));
  }
  if (path === "/api/gestion/planning" && method === "GET") {
    need("planning","planning_voir");
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
    need("groupes","groupes_voir","arrivees","planning","planning_voir");
    const rows=await groups(m);
    return json({ rows:me.rights.includes("groupes")||me.rights.includes("groupes_voir")?rows:rows.filter(row=>row.active) });
  }
  if ((path==="/api/gestion/groupes" && method==="POST") || (groupItem && ["GET","PATCH"].includes(method))) {
    need(...(method==="GET" ? ["groupes","groupes_voir"] : ["groupes"]));
    if (method==="GET") return json({rows:await members(m,groupItem,fail)});
    return json(await changeGroup(m,me,groupItem,await payload(request),fail,label,normalize));
  }
  if (path==="/api/gestion/seances/effectif" && method==="GET") {
    need("arrivees");
    return json(await roster(m,url.searchParams.get("kind"),url.searchParams.get("id"),fail));
  }
  if (path==="/api/gestion/seances" && ["GET","POST"].includes(method)) {
    need(...(method==="GET" ? ["arrivees","seances_voir"] : ["arrivees"]));
    if (method==="GET") return json({rows:await sessionsList(m,clock)});
    return json(await startSession(m,me,await payload(request),clock,fail,label));
  }
  const attendanceRoute=path.match(/^\/api\/gestion\/seances\/([a-f0-9-]+)(\/fin)?$/);
  if (attendanceRoute) {
    need(...(method==="GET" ? ["arrivees","seances_voir"] : ["arrivees"]));
    const [,id,finish]=attendanceRoute;
    if (finish && method==="POST") return json(await finishSession(m,me,id,await payload(request),clock,fail));
    if (!finish && method==="GET") return json(await sessionDetail(m,id,clock,fail));
    if (!finish && method==="PATCH") return json(await changeCall(m,me,id,await payload(request),clock,fail));
  }
  if (path==="/api/gestion/sauvegarde" && method==="GET") {
    need("sauvegarde","restaurer");
    return json({rows:me.rights.includes("sauvegarde") ? await m.list("SELECT id,created_at FROM encrypted_backups ORDER BY created_at DESC,id DESC") : []});
  }
  if (path==="/api/gestion/sauvegarde/export" && method==="POST") {
    need("sauvegarde");
    const {phrase}=await payload(request);
    const envelope=await encryptBackup(await exportBackup(m,clock,fail),phrase,fail);
    await m.batch([
      m.stmt("INSERT INTO encrypted_backups VALUES (?,?,?)",id(),clock,JSON.stringify(envelope)),
      m.stmt(`DELETE FROM encrypted_backups WHERE id NOT IN
        (SELECT id FROM encrypted_backups ORDER BY created_at DESC,id DESC LIMIT (SELECT backup_limit FROM privacy_settings WHERE id=1))`),
      audit(m,me,"sauvegarde","Export chiffré","Sauvegarde",null,null),
    ]);
    return json(envelope);
  }
  if (path==="/api/gestion/sauvegarde/etat/export" && method==="POST") {
    need("sauvegarde");
    const {phrase}=await payload(request);
    const envelope=await encryptBackup(JSON.stringify({format:"cdi-recovery",privacy:await recoveryState(m)}),phrase,fail);
    await m.batch([audit(m,me,"sauvegarde","Export de l’état de reprise","Historique des purges et effacements",null,null)]);
    return json(envelope);
  }
  if (path==="/api/gestion/sauvegarde/etat" && method==="POST") {
    need("restaurer");
    const {backup:encoded,phrase}=await payload(request,maxEnvelopeBytes);
    const file=await decryptBackup(encoded,phrase,fail);
    if (file.format!=="cdi-recovery" || !file.privacy) fail(400,"Ce fichier n’est pas un état de reprise.");
    await m.batch([...recoveryStatements(m,checkedPrivacyState(file.privacy,fail),clock,await privacySettings(m)),
      audit(m,me,"sauvegarde","Import de l’état de reprise","Historique des purges et effacements",null,null)]);
    return json({ok:true});
  }
  const backupId=path.match(/^\/api\/gestion\/sauvegarde\/([a-f0-9-]+)$/)?.[1];
  if (backupId && method==="GET") {
    need("sauvegarde");
    const saved=await m.one("SELECT envelope FROM encrypted_backups WHERE id=?",backupId);
    if (!saved) fail(404,"Sauvegarde indisponible.");
    await m.batch([audit(m,me,"sauvegarde","Téléchargement","Sauvegarde chiffrée",null,null)]);
    return jsonResponse(saved.envelope,200,{"Content-Disposition":'attachment; filename="TiceCDI-Sauvegarde.json"'});
  }
  if (path==="/api/gestion/sauvegarde" && method==="POST") {
    need("restaurer");
    const {backup:encoded,phrase,token}=await payload(request,maxEnvelopeBytes);
    const backup=await decryptBackup(encoded,phrase,fail);
    const summary=inspectBackup(backup,fail);
    const privacy=checkedPrivacyState(backup.privacy,fail);
    if (new TextEncoder().encode(JSON.stringify(backup)).byteLength>maxBackupBytes) fail(413,"Le fichier est trop volumineux.");
    const fingerprint=await digest(JSON.stringify(encoded));
    if (token===undefined) return json({...summary,token:fingerprint});
    if (!equal(token,fingerprint)) fail(409,"Analysez à nouveau le fichier avant de restaurer.");
    scrubLegacy(backup.tables);
    await restoreBackup(m,me,backup,summary,fail,recoveryStatements(m,privacy,clock,await privacySettings(m)));
    return json(summary);
  }
  if (path==="/api/gestion/journal" && method==="GET") {
    need("journal");
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
  // Notifications du personnel (24 dernières heures).
  if (path==="/api/gestion/notifications" && method==="GET") {
    need("presence","sorties","arrivees");
    const after=Number(url.searchParams.get("after")) || 0;
    return json({rows:await recentEvents(m,clock,Number.isSafeInteger(after)?after:0),now:clock});
  }
  // Tableau de bord en direct : présents, places, arrivées, départs proches, planning du jour et état de la borne.
  if (path==="/api/gestion/direct" && method==="GET") {
    need("presence","sorties","arrivees");
    const now=parisClock(clock), closure=kioskClosure(clock), start=parisMidnight(now.day);
    const internal=me.rights.includes("planning") || me.rights.includes("planning_voir");
    const [gauge,state,present,arrivals,leaving,totals,classesNow,slots,hours,events]=await Promise.all([
      occupancy(m,clock), m.one(closure.sql,...closure.params),
      m.one("SELECT count(*) AS total FROM visits WHERE ended_at IS NULL AND expires_at>?",clock),
      m.list(`SELECT v.starts_at,v.expires_at,v.source,v.reason,s.first_name,s.last_name,c.name AS class_name FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.starts_at>=? ORDER BY v.starts_at DESC LIMIT 8`,start),
      m.list(`SELECT v.expires_at,s.first_name,s.last_name,c.name AS class_name FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.ended_at IS NULL AND v.expires_at>? AND v.expires_at<=? ORDER BY v.expires_at LIMIT 10`,clock,clock+15*60_000),
      m.one("SELECT count(*) AS visits,count(DISTINCT student_id) AS students FROM visits WHERE starts_at>=?",start),
      m.list(`SELECT coalesce(v.class_name,c.name) AS name,count(*) AS total FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.ended_at IS NULL AND v.expires_at>? GROUP BY coalesce(v.class_name,c.name) ORDER BY total DESC,name LIMIT 12`,clock),
      m.list(`SELECT p.start_min,p.end_min,p.title,p.kind,p.students_allowed,coalesce(c.name,g.name) AS class_name FROM planning p
        LEFT JOIN classes c ON c.id=p.class_id LEFT JOIN school_groups g ON g.id=p.group_id WHERE p.day=? ORDER BY p.start_min`,now.day),
      m.list("SELECT start_min,end_min FROM opening_hours WHERE weekday=? ORDER BY start_min",now.weekday),
      recentEvents(m,clock),
    ]);
    const planning=internal ? slots : publicPlanning(slots.map(row=>({...row,day:now.day}))).map(({day,...row})=>row);
    return json({now:clock,minute:now.minute,...gauge,present:present.total,open:!state.reason,reason:state.reason,
      arrivals,leaving,today:totals,classes:classesNow,planning,hours,events,internal});
  }
  // Recherche d’élève pour une arrivée manuelle : nom, prénom ou classe, avec présence et exclusion en cours.
  if (path==="/api/gestion/presences/recherche" && method==="POST") {
    need("arrivees");
    const tokens=searchTokens((await payload(request)).q,words);
    if (!tokens.length) return json({rows:[]});
    const rows=rankMatches(await m.list(`SELECT s.id,s.first_name,s.last_name,s.search_name,c.name AS class_name,c.normalized AS class_key,
        EXISTS(SELECT 1 FROM visits v WHERE v.student_id=s.id AND v.ended_at IS NULL AND v.expires_at>?) AS present,
        EXISTS(SELECT 1 FROM exclusions x WHERE x.student_id=s.id AND x.revoked_at IS NULL AND x.until_day>=?) AS excluded
      FROM students s JOIN classes c ON c.id=s.class_id WHERE s.active=1 ${tokens.map(()=>"AND (s.search_name LIKE ? OR replace(c.normalized,' ','') LIKE ?)").join(" ")} LIMIT 200`,
      clock,today(),...tokens.flatMap(token=>["%"+token+"%",token+"%"])),tokens);
    return json({rows:rows.slice(0,12).map(({id,first_name,last_name,class_name,present,excluded})=>({id,first_name,last_name,class_name,present:Boolean(present),excluded:Boolean(excluded)}))});
  }
  // Arrivée enregistrée par le personnel (élève sans carte, oubli…) : hors horaires et créneaux réservés, mais jamais pour un élève exclu.
  if (path==="/api/gestion/presences" && method==="POST") {
    need("arrivees");
    const { student_id:studentId, two_hours:twoHours, reason:rawReason } = await payload(request);
    if (typeof studentId!=="string" || studentId.length>80 || (twoHours!==undefined && typeof twoHours!=="boolean")) fail(400,"Sélectionnez un élève.");
    const reason=visitReason(rawReason,fail);
    const person=await m.one(`SELECT s.id,c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND s.active=1`,studentId);
    if (!person) fail(404,"Élève introuvable ou fiche retirée.");
    const day=today();
    const excluded=await m.one("SELECT until_day FROM exclusions WHERE student_id=? AND revoked_at IS NULL AND until_day>=? ORDER BY until_day DESC LIMIT 1",person.id,day);
    if (excluded) fail(403,`Cet élève est exclu du CDI jusqu’au ${excluded.until_day.split("-").reverse().join("/")}.`);
    const current=await m.one("SELECT expires_at FROM visits WHERE student_id=? AND ended_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1",person.id,clock);
    if (current) {
      if (reason) await m.run("UPDATE visits SET reason=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?",reason,person.id,clock);
      return json({expires_at:current.expires_at,already:true});
    }
    const gauge=await occupancy(m,clock);
    if (gauge.places===0) fail(409,`Le CDI est complet (${gauge.capacity} places). Augmentez la capacité dans les réglages si besoin.`);
    const expires=presenceDeadline(clock)+(twoHours===true?HOUR:0);
    await m.batch([
      m.stmt("INSERT INTO visits (id,student_id,starts_at,expires_at,source,class_name,reason) VALUES (?,?,?,?,'individuel',?,?)",id(),person.id,clock,expires,person.class_name,reason),
      audit(m,me,"presences","Arrivée enregistrée par le personnel","Présence",null,null,true),
    ]);
    await capacityAlert(m,clock);
    return json({expires_at:expires,already:false});
  }
  if (resource === "presences") {
    if (method === "GET" && !itemId) {
      need("presence", "sorties", "arrivees");
      const rows = await m.list(`SELECT v.id,v.student_id,v.starts_at,v.expires_at,v.source,v.reason,s.first_name,s.last_name,c.name AS class_name
        FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.ended_at IS NULL AND v.expires_at>? ORDER BY v.expires_at,s.last_name`, clock);
      return json({ rows, now: clock, ...await occupancy(m,clock) });
    }
    if (method === "PATCH" && itemId) {
      const body = await payload(request);
      // Motif de présence seul : modifiable par les agents qui gèrent les sorties ou les arrivées.
      if (Object.hasOwn(body, "reason") && body.minutes === undefined) {
        need("sorties", "arrivees");
        const reason = visitReason(body.reason, fail);
        const updated = await m.run("UPDATE visits SET reason=? WHERE id=? AND ended_at IS NULL AND expires_at>?", reason, itemId, clock);
        if (!changes(updated)) fail(409, "Cette présence est terminée.");
        return json({ reason });
      }
      need("sorties");
      const { minutes, expires_at } = body;
      if (![15, 30, 60].includes(minutes) || !Number.isSafeInteger(expires_at)) fail(400, "Choisissez une prolongation de 15, 30 ou 60 minutes.");
      const visit = await m.one(`SELECT expires_at,ended_at FROM visits WHERE id=?`, itemId);
      if (!visit || visit.ended_at !== null || visit.expires_at <= clock) fail(409, "Cette présence est terminée.");
      if (visit.expires_at !== expires_at) fail(409, "Le départ prévu a changé. Fermez cette fenêtre et ouvrez à nouveau la prolongation.");
      const updated = expires_at + minutes * 60_000;
      const [result] = await m.batch([
        m.stmt("UPDATE visits SET expires_at=? WHERE id=? AND ended_at IS NULL AND expires_at=? AND expires_at>?", updated, itemId, expires_at, Date.now()),
        audit(m, me, "presences", "Prolongation de présence", "Présence", null, null, true),
      ]);
      if (!changes(result)) fail(409, "La présence a changé. Fermez cette fenêtre et ouvrez à nouveau la prolongation.");
      return json({ expires_at: updated });
    }
    if (method === "DELETE" && itemId) {
      need("sorties");
      const closed=await m.run("UPDATE visits SET ended_at=? WHERE id=? AND ended_at IS NULL AND expires_at>?", clock, itemId, clock);
      if (!changes(closed)) fail(409,"Cette présence est déjà terminée ou son créneau a expiré.");
      return json({ ok: true });
    }
  }
  if (resource === "classes") {
    if (method === "GET" && !itemId) {
      need("classes", "classes_voir", "eleves", "eleves_voir", "badges", "import", "presence", "sorties", "arrivees", "seances_voir", "planning", "planning_voir", "groupes", "groupes_voir", "exclusions", "exclusions_voir", "dossiers_voir", "donnees");
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
      // Les élèves actifs vont dans la classe choisie ; les fiches retirées rejoignent « Anciens élèves » si aucune classe n’est choisie.
      const current = await m.one(`SELECT name,(SELECT count(*) FROM students WHERE class_id=c.id AND active=1) AS active,
        (SELECT count(*) FROM students WHERE class_id=c.id AND active=0) AS retired FROM classes c WHERE id=?`, itemId);
      if (!current) fail(404, "Classe introuvable.");
      const data = await payload(request).catch(() => ({}));
      let target = typeof data.move_to === "string" && data.move_to ? data.move_to : null;
      if (target && (target === itemId || !await m.one("SELECT id FROM classes WHERE id=?", target))) fail(400, "Choisissez une autre classe existante.");
      if (current.active && !target) fail(409, `Choisissez la classe qui accueillera les ${current.active} élève${current.active > 1 ? "s" : ""} de ${current.name}.`);
      const statements = [];
      if (!target && current.retired) {
        target = (await m.one("SELECT id FROM classes WHERE normalized=?", "anciens eleves"))?.id;
        if (!target) { target = id(); statements.push(m.stmt("INSERT INTO classes VALUES (?,?,?)", target, "Anciens élèves", "anciens eleves")); }
        if (target === itemId) fail(409, "La classe « Anciens élèves » conserve les fiches retirées.");
      }
      if (target) statements.push(m.stmt("UPDATE students SET class_id=? WHERE class_id=?", target, itemId));
      statements.push(m.stmt("DELETE FROM classes WHERE id=?", itemId),
        audit(m, me, "confidentialite", "Suppression d’une classe", current.name, null, { eleves_deplaces:current.active + current.retired }));
      await m.batch(statements);
      return json({ ok: true, moved: current.active + current.retired });
    }
  }
  const studentSearch=path==="/api/gestion/eleves/recherche" && method==="POST";
  if (resource==="eleves" || studentSearch) {
    if ((method==="GET" && !itemId) || studentSearch) {
      const filter=studentSearch ? await payload(request) : Object.fromEntries(url.searchParams);
      const forBadges = filter.badges === "1";
      need(...(forBadges ? ["badges"] : ["eleves", "eleves_voir", "exclusions", "groupes"]));
      const classId = clean(filter.class);
      const active = !forBadges && me.rights.includes("eleves") && filter.archived === "1" ? 0 : 1;
      const search = words(studentSearch ? clean(filter.q).slice(0,90) : "").split(" ").filter(Boolean).slice(0, 8);
      const query = search.map(() => "AND instr(s.search_name,?)>0").join(" ");
      const extra = forBadges ? ",s.code" : "";
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
    need(...(method === "GET" && !itemId ? ["exclusions", "exclusions_voir"] : ["exclusions"]));
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
    need("comptes", "comptes_voir");
    if (method === "GET" && !itemId) return json({ rows: (await m.list(`SELECT a.*,EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS mfa
      FROM accounts a ORDER BY a.admin DESC,a.name`)).map((row) => ({ ...publicAccount(row), mfa: Boolean(row.mfa) })) });
    need("comptes");
    const target = itemId ? await m.one("SELECT * FROM accounts WHERE id=?", itemId) : null;
    if (itemId && !target) fail(404, "Compte introuvable.");
    if (target && !me.admin && (target.admin || publicAccount(target).rights.some((right) => !me.rights.includes(right)))) fail(403, "Ce compte ne peut pas être modifié avec vos droits.");
    if (method === "DELETE" && itemId) {
      if (target.id === me.id) fail(409, "Votre compte ne peut pas être supprimé depuis votre session.");
      const [deleted]=await m.batch([
        m.stmt("DELETE FROM accounts WHERE id=? AND (admin=0 OR (SELECT count(*) FROM accounts WHERE admin=1)>1)",target.id),
        audit(m,me,"confidentialite","Suppression d’un compte","Comptes",null,null,true),
      ]);
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
        actions.push(audit(m,me,"confidentialite","Modification d’un compte ou de ses droits","Comptes",null,null,true));
        if (secret !== target.secret) actions.push(m.stmt("DELETE FROM sessions WHERE account_id=?", target.id));
        if (!changes((await m.batch(actions))[0])) fail(409, "Au moins un compte administrateur doit rester actif.");
        if (secret !== target.secret && me.id === target.id) return openSession(m, request, target.id, client);
      } else await m.batch([
        m.stmt("INSERT INTO accounts VALUES (?,?,?,?,?,?)", id(), login, name, secret, JSON.stringify(rights), Number(admin)),
        audit(m,me,"confidentialite","Création d’un compte","Comptes",null,null),
      ]);
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
    console.error("TiceCDI API", error.name);
    return json({ error: "Le service est temporairement indisponible. Réessayez dans un instant." }, 500);
  }
}
