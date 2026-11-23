// Notifications du personnel : élève exclu à la borne, CDI presque plein (90 %) ou complet. Conservées 48 heures.
// Logique identique à php/app/presence.php (édition PHP).
import { occupancy } from "./capacity.mjs";

const KEEP = 48 * 3_600_000;
const QUIET = 30 * 60_000;
export async function kioskEvent(m, kind, message, clock, quiet = 0) {
  if (quiet && await m.one("SELECT 1 AS yes FROM kiosk_events WHERE kind=? AND at>?", kind, clock - quiet)) return;
  await m.batch([
    m.stmt("DELETE FROM kiosk_events WHERE at<?", clock - KEEP),
    m.stmt("INSERT INTO kiosk_events (at,kind,message) VALUES (?,?,?)", clock, kind, message),
  ]);
}
// Après une arrivée : alerte « presque plein » à 90 % de la capacité (au plus une toutes les 30 minutes).
export async function capacityAlert(m, clock) {
  const state = await occupancy(m, clock);
  if (!state.capacity || state.occupied / state.capacity < 0.9) return;
  await kioskEvent(m, state.places === 0 ? "complet" : "presque_plein",
    state.places === 0 ? `Le CDI est complet : ${state.occupied} élèves pour ${state.capacity} places.` : `Le CDI est presque plein : ${state.occupied} élèves pour ${state.capacity} places.`,
    clock, QUIET);
}
export const fullRefused = (clock, m) => kioskEvent(m, "complet", "Le CDI est complet : une entrée a été refusée à la borne.", clock, 10 * 60_000);
export const excludedAttempt = (clock, m, person) =>
  kioskEvent(m, "exclu", `${person.first_name} ${person.last_name} (${person.class_name}) a tenté d’entrer à la borne alors qu’une exclusion du CDI est en cours.`, clock);
export async function recentEvents(m, clock, after = 0) {
  return m.list("SELECT id,at,kind,message FROM kiosk_events WHERE at>? AND id>? ORDER BY id DESC LIMIT 50", clock - 24 * 3_600_000, after);
}
