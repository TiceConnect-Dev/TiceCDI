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

const columns = "substr(k.token,1,16) AS id,k.label,k.created_at,k.last_seen,k.expires_at,k.agent,k.address,a.name AS activated_by,k.account_id";

// Routes /api/gestion/borne/postes ; retourne null si la route n'est pas concernée.
export async function devicesApi(ctx) {
  const { m, request, me, path, method, clock, json, fail, payload, audit, currentDevice } = ctx;
  if (!path.startsWith("/api/gestion/borne/postes")) return null;
  if (!me.admin && !me.rights.includes("borne")) fail(403, "Votre compte ne dispose pas de cet accès.");
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
export function searchTokens(query, words) {
  const tokens = words(query).split(" ").filter((token) => token.length >= 2).slice(0, 4);
  return tokens.join("").length >= 3 ? tokens : [];
}
export function kioskLabel(row) {
  return `${row.first_name} ${row.last_name.trim().charAt(0).toLocaleUpperCase("fr")}.`;
}
