// Postes de borne : durée d'activation, renouvellement automatique et gestion des postes activés.
// Logique identique à php/app/devices.php (édition PHP).
const HOUR = 3_600_000, DAY = 24 * HOUR;
export const DURATIONS = { "12h":12 * HOUR, "7j":7 * DAY, "30j":30 * DAY, annee:null };

// Fin de l'année scolaire : 31 août à 23 h 59 (heure de Paris), l'année en cours ou la suivante à partir de septembre.
export function schoolYearEnd(clock) {
  const date = new Date(clock);
  const year = date.getUTCMonth() >= 8 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  return Date.UTC(year, 7, 31, 21, 59, 59);
}
export function deviceExpiry(settings, clock) {
  return settings.duration === "annee" ? schoolYearEnd(clock) : clock + DURATIONS[settings.duration];
}
export async function deviceSettings(m) {
  const row = await m.one("SELECT duration,renew,name_search FROM kiosk_device_settings WHERE id=1");
  return { duration:row?.duration ?? "30j", renew:row ? row.renew === 1 : true, name_search:row ? row.name_search === 1 : true };
}

// Appelé à chaque interrogation de la borne : dernière activité (au plus une fois par minute) et prolongation glissante.
// Retourne la nouvelle échéance quand le cookie doit être renouvelé.
export async function touchDevice(m, device, clock) {
  if (device.last_seen > clock - 60_000) return null;
  const settings = await deviceSettings(m);
  const next = deviceExpiry(settings, clock);
  const renew = settings.renew && settings.duration !== "annee" && next - device.expires_at > HOUR;
  await m.run("UPDATE kiosk_devices SET last_seen=?,expires_at=? WHERE token=?", clock, renew ? next : device.expires_at, device.token);
  return renew ? next : null;
}

// Activation par code : 8 chiffres, valable 10 minutes, à usage unique (un seul code en cours par compte).
export const CODE_TTL = 10 * 60_000;
const sha256 = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const codeDigest = (code) => sha256("kiosk-code:" + code);
export function newActivationCode() {
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= 4_200_000_000);
  return String(value[0] % 100_000_000).padStart(8, "0");
}
// Saisie de la borne : espaces ignorés, chiffres tapés en AZERTY sans majuscule acceptés (« - » vaut 6,
// sauf s'il sert de séparateur : « 1234-5678 »).
export function activationCode(value) {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/g, "");
  const digits = (raw) => [...raw].map((char) => azertyDigits[char] ?? char).join("");
  return [digits(text), digits(text.replace(/-/g, ""))].find((code) => /^[0-9]{8}$/.test(code)) ?? "";
}

const columns = "substr(k.token,1,16) AS id,k.label,k.created_at,k.last_seen,k.expires_at,k.agent,k.address,a.name AS activated_by,k.account_id";

// Routes /api/gestion/borne/postes ; retourne null si la route n'est pas concernée.
export async function devicesApi(ctx) {
  const { m, request, me, path, method, clock, json, fail, payload, audit, currentDevice } = ctx;
  if (!path.startsWith("/api/gestion/borne/postes") && path !== "/api/gestion/borne/code") return null;
  if (!me.admin && !me.rights.includes("borne")) fail(403, "Votre compte ne dispose pas de cet accès.");
  if (path === "/api/gestion/borne/code" && method === "POST") {
    const data = request.headers.get("content-type")?.startsWith("application/json") ? await payload(request) : {};
    const label = String(data.label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const code = newActivationCode(), expires = clock + CODE_TTL;
    await m.batch([
      m.stmt("DELETE FROM kiosk_codes WHERE expires_at<=? OR account_id=?", clock, me.id),
      m.stmt("INSERT INTO kiosk_codes (code,account_id,label,created_at,expires_at) VALUES (?,?,?,?,?)", await codeDigest(code), me.id, label, clock, expires),
      audit(m, me, "confidentialite", "Création d’un code d’activation de borne", label || "Borne", null, null),
    ]);
    return json({ code, label, expires_at:expires });
  }
  if (path === "/api/gestion/borne/code" && method === "DELETE") {
    await m.run("DELETE FROM kiosk_codes WHERE account_id=?", me.id);
    return json({ ok:true });
  }
  if (path === "/api/gestion/borne/postes" && method === "GET") {
    const rows = await m.list(`SELECT ${columns} FROM kiosk_devices k JOIN accounts a ON a.id=k.account_id
      WHERE k.expires_at>? ${me.admin ? "" : "AND k.account_id=?"} ORDER BY k.last_seen DESC,k.created_at DESC`, clock, ...(me.admin ? [] : [me.id]));
    return json({ settings:await deviceSettings(m), rows:rows.map(({ account_id, ...row }) => ({ ...row, current:row.id === currentDevice, own:account_id === me.id })) });
  }
  if (path === "/api/gestion/borne/postes" && method === "PATCH") {
    if (!me.admin) fail(403, "Seul un administrateur peut modifier la durée d’activation des postes.");
    const data = await payload(request);
    if (!(data.duration in DURATIONS) || typeof data.renew !== "boolean") fail(400, "Choisissez une durée d’activation valide.");
    const before = await deviceSettings(m);
    const nameSearch = typeof data.name_search === "boolean" ? data.name_search : before.name_search;
    await m.batch([
      m.stmt(`INSERT INTO kiosk_device_settings (id,duration,renew,name_search) VALUES (1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET duration=excluded.duration,renew=excluded.renew,name_search=excluded.name_search`, data.duration, Number(data.renew), Number(nameSearch)),
      audit(m, me, "confidentialite", "Modification des réglages des postes de borne", "Borne", before, { duration:data.duration, renew:data.renew, name_search:nameSearch }),
    ]);
    return json(await deviceSettings(m));
  }
  const one = /^\/api\/gestion\/borne\/postes\/([a-f0-9]{16})$/.exec(path);
  if (one && method === "DELETE") {
    const device = await m.one("SELECT token,account_id,label FROM kiosk_devices WHERE substr(token,1,16)=?", one[1]);
    if (!device || (!me.admin && device.account_id !== me.id)) fail(404, "Poste introuvable ou déjà révoqué.");
    await m.batch([
      m.stmt("DELETE FROM kiosk_devices WHERE token=?", device.token),
      audit(m, me, "confidentialite", "Révocation d’un poste", device.label || "Borne", null, null),
    ]);
    return json({ ok:true });
  }
  fail(404, "Action introuvable.");
}

// Recherche par nom sur la borne : au plus 6 résultats, prénom et initiale du nom seulement, sélection valable 3 minutes.
// Recherche par nom sur la borne : 2 lettres suffisent, l’ordre des mots est libre (« martin lina », « lin mar »),
// un mot peut viser la classe (« lina 2nde3 ») et une faute de frappe est tolérée quand rien ne correspond exactement.
export function searchTokens(query, words) {
  const tokens = words(query).split(" ").filter(Boolean).slice(0, 4);
  return tokens.join("").length >= 2 ? tokens : [];
}
function distance(a, b) {
  const row = Array.from({ length:b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}
// Score d’un élève (plus petit = meilleur) ; null s’il ne correspond pas. rows : {search_name, class_key}.
export function matchScore(row, tokens, fuzzy = false) {
  const names = row.search_name.split(" "), group = (row.class_key ?? "").replace(/\s+/g, "");
  let score = 0;
  for (const token of tokens) {
    let best = Infinity;
    for (const name of names) {
      if (name === token) best = Math.min(best, 0);
      else if (name.startsWith(token)) best = Math.min(best, 1);
      else if (token.length >= 3 && name.includes(token)) best = Math.min(best, 4);
      else if (fuzzy && token.length >= 3) {
        const allowed = token.length <= 4 ? 1 : 2;
        const gap = Math.min(distance(token, name), distance(token, name.slice(0, token.length)) + 1);
        if (gap <= allowed) best = Math.min(best, 6 + gap);
      }
    }
    if (group && (group === token || (token.length >= 2 && group.startsWith(token)))) best = Math.min(best, 2);
    if (best === Infinity) return null;
    score += best;
  }
  return score;
}
export function rankMatches(rows, tokens, fuzzy = false) {
  return rows.map((row) => ({ row, score:matchScore(row, tokens, fuzzy) })).filter((item) => item.score !== null)
    .sort((a, b) => a.score - b.score || a.row.last_name.localeCompare(b.row.last_name, "fr") || a.row.first_name.localeCompare(b.row.first_name, "fr"))
    .map((item) => item.row);
}
export function kioskLabel(row) {
  return `${row.first_name} ${row.last_name.trim().charAt(0).toLocaleUpperCase("fr")}.`;
}

// Code de carte reçu d’une douchette (clavier QWERTY sur poste AZERTY, préfixe AIM, casse) : même règle que la borne.
const azertyDigits={"&":"1","é":"2","É":"2","\"":"3","'":"4","(":"5","-":"6","§":"6","è":"7","È":"7","_":"8","!":"8","ç":"9","Ç":"9","à":"0","À":"0"};
export function cardCode(value) {
  const text=[...String(value??"").normalize("NFC").replace(/\s+/g,"")].map(char=>azertyDigits[char]??char).join("").toUpperCase();
  const at=text.indexOf("CDI");
  if (at<0) return "";
  const body=text.slice(at+3,at+13).replace(/Q/g,"A");
  return /^[0-9A-F]{10}$/.test(body) ? "CDI"+body : "";
}
