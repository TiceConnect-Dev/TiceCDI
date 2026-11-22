// Sécurité des comptes : double authentification TOTP, codes de secours, sessions actives et traces de connexion.
// La logique est reproduite à l’identique dans php/app/security.php pour l’édition PHP.
const encoder = new TextEncoder();
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const STEP_MS = 30_000;
export const RECOVERY_COUNT = 10;

export function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8 | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const char of text) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Secret TOTP invalide");
    value = (value << 5 | index) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
export async function totp(secret, step) {
  const key = await crypto.subtle.importKey("raw", unbase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new DataView(new ArrayBuffer(8));
  counter.setUint32(0, Math.floor(step / 2 ** 32));
  counter.setUint32(4, step >>> 0);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter.buffer));
  const offset = hmac[19] & 15;
  const code = ((hmac[offset] & 127) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}
// Retourne le pas de temps accepté (fenêtre de ±30 s) ou 0. Un pas déjà utilisé est refusé (anti-rejeu).
export async function matchTotp(secret, code, lastStep, clock) {
  const now = Math.floor(clock / STEP_MS);
  let found = 0;
  for (const step of [now - 1, now, now + 1]) if (step > lastStep && await totp(secret, step) === code) found = step;
  return found;
}
export function newTotpSecret() { return base32(crypto.getRandomValues(new Uint8Array(20))); }
export function otpauth(secret, username) {
  return `otpauth://totp/${encodeURIComponent("TiceCDI:" + username)}?secret=${secret}&issuer=TiceCDI&algorithm=SHA1&digits=6&period=30`;
}
function recoveryCode() {
  let code = "";
  while (code.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && code.length < 8) code += RECOVERY_ALPHABET[byte % 31];
    }
  }
  return code.slice(0, 4) + "-" + code.slice(4);
}
export const normalizeCode = (value) => typeof value === "string" ? value.toLowerCase().replace(/[\s-]/g, "").slice(0, 20) : "";
async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function recoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, recoveryCode);
  return { codes, hashes: JSON.stringify(await Promise.all(codes.map((code) => sha256(normalizeCode(code))))) };
}
// Résumé lisible du navigateur (« Firefox · Windows ») : l’en-tête complet n’est pas conservé.
export function agentSummary(agent = "") {
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS"
    : /Mac OS X/.test(agent) ? "macOS" : /CrOS/.test(agent) ? "ChromeOS" : /Linux/.test(agent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ") || "Navigateur inconnu";
}

// Vérifie un code TOTP ou un code de secours et le consomme. Retourne "totp", "secours" ou "".
export async function consumeSecondFactor(m, accountId, mfa, input, clock) {
  const code = normalizeCode(input);
  if (/^\d{6}$/.test(code)) {
    const step = await matchTotp(mfa.secret, code, mfa.last_step, clock);
    if (!step) return "";
    const result = await m.run("UPDATE account_mfa SET last_step=? WHERE account_id=? AND last_step<?", step, accountId, step);
    return result.meta.changes ? "totp" : "";
  }
  if (!/^[a-z0-9]{8}$/.test(code)) return "";
  const hash = await sha256(code);
  const list = JSON.parse(mfa.recovery || "[]");
  if (!list.includes(hash)) return "";
  const result = await m.run("UPDATE account_mfa SET recovery=? WHERE account_id=? AND recovery=?", JSON.stringify(list.filter((item) => item !== hash)), accountId, mfa.recovery);
  return result.meta.changes ? "secours" : "";
}

const sessionColumns = "substr(t.token,1,16) AS id,t.created_at,t.last_seen,t.agent,t.address,t.expires_at";

// Routes /api/gestion/securite… et /api/gestion/sessions… ; retourne null si la route n’est pas concernée.
export async function securityApi(ctx) {
  const { m, request, me, path, method, clock, json, fail, payload, audit, verifyPassword, currentToken, cookie } = ctx;
  const current = currentToken ? currentToken.slice(0, 16) : "";
  const mfaRow = (accountId) => m.one("SELECT * FROM account_mfa WHERE account_id=?", accountId);
  const checkPassword = async (password) => {
    const account = await m.one("SELECT secret FROM accounts WHERE id=?", me.id);
    if (!(await verifyPassword(typeof password === "string" ? password.slice(0, 161) : "", account?.secret)).ok) fail(403, "Mot de passe actuel incorrect.");
  };

  if (path === "/api/gestion/securite" && method === "GET") {
    const mfa = await mfaRow(me.id);
    const sessions = await m.list(`SELECT ${sessionColumns} FROM sessions t WHERE t.account_id=? AND t.expires_at>? ORDER BY t.last_seen DESC`, me.id, clock);
    return json({
      mfa: { enabled: Boolean(mfa?.secret), recovery_left: mfa?.secret ? JSON.parse(mfa.recovery).length : 0, enabled_at: mfa?.enabled_at ?? null },
      sessions: sessions.map((row) => ({ ...row, current: row.id === current })),
    });
  }
  if (path === "/api/gestion/securite/totp" && method === "POST") {
    const data = await payload(request);
    await checkPassword(data.password);
    if ((await mfaRow(me.id))?.secret) fail(409, "La double authentification est déjà active.");
    const secret = newTotpSecret();
    await m.run(`INSERT INTO account_mfa (account_id,pending) VALUES (?,?)
      ON CONFLICT(account_id) DO UPDATE SET pending=excluded.pending`, me.id, secret);
    return json({ secret, uri: otpauth(secret, me.username) });
  }
  if (path === "/api/gestion/securite/totp/activation" && method === "POST") {
    const data = await payload(request);
    const mfa = await mfaRow(me.id);
    if (!mfa?.pending || mfa.secret) fail(409, "Recommencez l’activation de la double authentification.");
    const step = await matchTotp(mfa.pending, normalizeCode(data.code), 0, clock);
    if (!step) fail(400, "Code incorrect. Vérifiez l’heure du téléphone et saisissez le code affiché.");
    const { codes, hashes } = await recoveryCodes();
    await m.batch([
      m.stmt("UPDATE account_mfa SET secret=pending,pending=NULL,last_step=?,recovery=?,enabled_at=? WHERE account_id=? AND secret IS NULL", step, hashes, clock, me.id),
      m.stmt("DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)<>?", me.id, current),
      audit(m, me, "securite", "Activation de la double authentification", me.username, null, null),
    ]);
    return json({ codes });
  }
  if (path === "/api/gestion/securite/totp/desactivation" && method === "POST") {
    const data = await payload(request);
    await checkPassword(data.password);
    const mfa = await mfaRow(me.id);
    if (!mfa?.secret) fail(409, "La double authentification n’est pas active.");
    if (!await consumeSecondFactor(m, me.id, mfa, data.code, clock)) fail(403, "Code de vérification incorrect.");
    await m.batch([
      m.stmt("DELETE FROM account_mfa WHERE account_id=?", me.id),
      audit(m, me, "securite", "Désactivation de la double authentification", me.username, null, null),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/gestion/securite/codes" && method === "POST") {
    const data = await payload(request);
    await checkPassword(data.password);
    if (!(await mfaRow(me.id))?.secret) fail(409, "La double authentification n’est pas active.");
    const { codes, hashes } = await recoveryCodes();
    await m.batch([
      m.stmt("UPDATE account_mfa SET recovery=? WHERE account_id=?", hashes, me.id),
      audit(m, me, "securite", "Nouveaux codes de secours", me.username, null, null),
    ]);
    return json({ codes });
  }
  const own = /^\/api\/gestion\/securite\/sessions(?:\/([a-f0-9]{16}))?$/.exec(path);
  if (own && method === "DELETE") {
    const target = own[1];
    const [removed] = await m.batch([
      target ? m.stmt("DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)=?", me.id, target)
        : m.stmt("DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)<>?", me.id, current),
      audit(m, me, "securite", target ? "Fermeture d’une session" : "Fermeture des autres sessions", me.username, null, null, true),
    ]);
    if (target && !removed.meta.changes) fail(404, "Session introuvable ou déjà fermée.");
    return json({ ok: true }, 200, target === current ? { "Set-Cookie": cookie(request, "", 0) } : {});
  }
  if (path === "/api/gestion/sessions" && method === "GET") {
    if (!me.admin) fail(403, "Cette rubrique est réservée aux administrateurs.");
    const rows = await m.list(`SELECT ${sessionColumns},a.name,a.username,
      EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS mfa
      FROM sessions t JOIN accounts a ON a.id=t.account_id WHERE t.expires_at>? ORDER BY t.last_seen DESC LIMIT 500`, clock);
    return json({ rows: rows.map((row) => ({ ...row, mfa: Boolean(row.mfa), current: row.id === current })) });
  }
  const any = /^\/api\/gestion\/sessions\/([a-f0-9]{16})$/.exec(path);
  if (any && method === "DELETE") {
    if (!me.admin) fail(403, "Cette rubrique est réservée aux administrateurs.");
    const owner = await m.one("SELECT a.username FROM sessions t JOIN accounts a ON a.id=t.account_id WHERE substr(t.token,1,16)=?", any[1]);
    if (!owner) fail(404, "Session introuvable ou déjà fermée.");
    await m.batch([
      m.stmt("DELETE FROM sessions WHERE substr(token,1,16)=?", any[1]),
      audit(m, me, "securite", "Fermeture d’une session par un administrateur", owner.username, null, null),
    ]);
    return json({ ok: true }, 200, any[1] === current ? { "Set-Cookie": cookie(request, "", 0) } : {});
  }
  const reset = /^\/api\/gestion\/comptes\/([a-f0-9-]+)\/double-authentification$/.exec(path);
  if (reset && method === "DELETE") {
    if (!me.admin) fail(403, "Seul un administrateur peut réinitialiser la double authentification.");
    const target = await m.one("SELECT id,username FROM accounts WHERE id=?", reset[1]);
    if (!target) fail(404, "Compte introuvable.");
    if (target.id === me.id) fail(409, "Désactivez votre double authentification depuis « Sécurité du compte ».");
    if (!await mfaRow(target.id)) fail(409, "Ce compte n’utilise pas la double authentification.");
    const [, removed] = await m.batch([
      m.stmt("DELETE FROM sessions WHERE account_id=?", target.id),
      m.stmt("DELETE FROM account_mfa WHERE account_id=?", target.id),
      audit(m, me, "securite", "Réinitialisation de la double authentification", target.username, null, null, true),
    ]);
    if (!removed.meta.changes) fail(409, "Ce compte n’utilise pas la double authentification.");
    return json({ ok: true });
  }
  return null;
}
