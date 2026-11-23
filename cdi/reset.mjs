// Réinitialisation des données (administrateurs) : statistiques, fiches d’appel, passages, alertes et journal,
// sur une période ou en totalité. Comptes, élèves, classes, planning et réglages ne sont jamais touchés.
// Logique identique à php/app/backup.php (édition PHP).
import { parisMidnight } from "./calendar.mjs";
import { audit } from "./audit.mjs";

export const RESET_TARGETS = ["statistiques", "appels", "passages", "alertes", "journal"];
const LABELS = { statistiques:"Statistiques", appels:"Fiches d’appel", passages:"Passages", alertes:"Alertes", journal:"Journal" };
const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T12:00:00Z"));
const nextDay = (day) => new Date(Date.parse(day + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);

export function checkReset(data, today, fail) {
  const targets = Array.isArray(data?.targets) ? [...new Set(data.targets)] : [];
  if (!targets.length || targets.some((target) => !RESET_TARGETS.includes(target))) fail(400, "Choisissez au moins une donnée à vider.");
  if (data.confirm !== "VIDER") fail(400, "Tapez VIDER pour confirmer.");
  if (data.scope === "tout") return { targets, all:true, from:"0000-01-01", to:"9999-12-31", start:0, end:Number.MAX_SAFE_INTEGER };
  if (data.scope !== "periode" || !validDay(data.from) || !validDay(data.to) || data.from > data.to) fail(400, "Choisissez une période valide.");
  if (data.from > today) fail(400, "La période doit commencer au plus tard aujourd’hui.");
  return { targets, all:false, from:data.from, to:data.to, start:parisMidnight(data.from), end:parisMidnight(nextDay(data.to)) };
}

// Requêtes de suppression, dans un ordre compatible avec les clés étrangères.
export function resetStatements(m, plan) {
  const { targets, from, to, start, end } = plan, has = (target) => targets.includes(target), list = [];
  if (has("statistiques")) list.push(
    m.stmt("DELETE FROM daily_statistics WHERE day BETWEEN ? AND ?", from, to),
    m.stmt("DELETE FROM archived_breakdown WHERE day BETWEEN ? AND ?", from, to));
  if (has("passages")) list.push(m.stmt("DELETE FROM visits WHERE starts_at>=? AND starts_at<?", start, end));
  if (has("appels")) list.push(
    m.stmt("UPDATE visits SET attendance_id=NULL WHERE attendance_id IN (SELECT id FROM attendance WHERE started_at>=? AND started_at<?)", start, end),
    m.stmt("DELETE FROM attendance_members WHERE attendance_id IN (SELECT id FROM attendance WHERE started_at>=? AND started_at<?)", start, end),
    m.stmt("DELETE FROM attendance WHERE started_at>=? AND started_at<?", start, end));
  if (has("alertes")) list.push(m.stmt("DELETE FROM kiosk_events WHERE at>=? AND at<?", start, end));
  if (has("journal")) list.push(m.stmt("DELETE FROM audit_log WHERE at>=? AND at<?", start, end));
  return list;
}
export async function resetCounts(m, plan) {
  const { from, to, start, end } = plan;
  const [stats, visits, sheets, events, journal] = await Promise.all([
    m.one("SELECT (SELECT count(*) FROM daily_statistics WHERE day BETWEEN ? AND ?) AS n", from, to),
    m.one("SELECT count(*) AS n FROM visits WHERE starts_at>=? AND starts_at<?", start, end),
    m.one("SELECT count(*) AS n FROM attendance WHERE started_at>=? AND started_at<?", start, end),
    m.one("SELECT count(*) AS n FROM kiosk_events WHERE at>=? AND at<?", start, end),
    m.one("SELECT count(*) AS n FROM audit_log WHERE at>=? AND at<?", start, end),
  ]);
  return { statistiques:stats.n, passages:visits.n, appels:sheets.n, alertes:events.n, journal:journal.n };
}
export async function resetData(m, me, data, today, fail) {
  const plan = checkReset(data, today, fail);
  const counts = await resetCounts(m, plan);
  const summary = { donnees:plan.targets.map((target) => LABELS[target]).join(", "), periode:plan.all ? "Tout" : `${plan.from} au ${plan.to}` };
  // L’entrée du journal est écrite après la suppression : la réinitialisation reste tracée même si le journal est vidé.
  await m.batch([...resetStatements(m, plan), audit(m, me, "confidentialite", "Réinitialisation des données", "Données", null, summary)]);
  return { counts:Object.fromEntries(plan.targets.map((target) => [target, counts[target]])) };
}
