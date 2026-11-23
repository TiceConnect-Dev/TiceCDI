// Affichage de la borne : réglages visuels (annonces, règles, écran de repos, thème) et planning du jour.
// Logique identique à php/app/devices.php (édition PHP).
import { parisClock } from "./calendar.mjs";
import { publicPlanning } from "./privacy.mjs";

export const TONES = ["info", "succes", "attention", "alerte", "evenement"];
export const THEMES = ["clair", "sombre", "horaire"];
export const DISPLAY_DEFAULTS = {
  show_places:true, show_planning:true, scan_animation:true, confirm_seconds:4,
  announcements:[], rules:["Travail calme et respect de chacun", "Ni nourriture ni boisson", "Téléphone rangé"],
  idle_enabled:true, idle_delay:60, theme:"clair", dark_from:17, dark_to:8,
};
const text = (value, limit) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";

// Contrôle complet ; `fail` (code, message) est appelé pour une valeur invalide.
export function checkDisplay(data, fail) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Les réglages d’affichage sont incomplets.");
  const out = { ...DISPLAY_DEFAULTS };
  for (const key of ["show_places", "show_planning", "scan_animation", "idle_enabled"]) {
    if (data[key] !== undefined && typeof data[key] !== "boolean") fail(400, "Les réglages d’affichage sont incomplets.");
    if (data[key] !== undefined) out[key] = data[key];
  }
  const integer = (key, min, max, message) => {
    if (data[key] === undefined) return;
    if (!Number.isInteger(data[key]) || data[key] < min || data[key] > max) fail(400, message);
    out[key] = data[key];
  };
  integer("confirm_seconds", 2, 10, "La confirmation dure de 2 à 10 secondes.");
  integer("idle_delay", 15, 900, "L’écran de repos s’affiche après 15 secondes à 15 minutes.");
  integer("dark_from", 0, 23, "Choisissez une heure de début du thème sombre.");
  integer("dark_to", 0, 23, "Choisissez une heure de fin du thème sombre.");
  if (data.theme !== undefined) { if (!THEMES.includes(data.theme)) fail(400, "Choisissez un thème."); out.theme = data.theme; }
  if (data.announcements !== undefined) {
    if (!Array.isArray(data.announcements) || data.announcements.length > 6) fail(400, "Six annonces au maximum.");
    out.announcements = data.announcements.map((item) => {
      const message = text(item?.text, 160);
      if (!message || !TONES.includes(item?.tone)) fail(400, "Chaque annonce a un texte (160 caractères au plus) et une couleur.");
      return { text:message, tone:item.tone };
    });
  }
  if (data.rules !== undefined) {
    if (!Array.isArray(data.rules) || data.rules.length > 6) fail(400, "Six règles au maximum.");
    out.rules = data.rules.map((rule) => text(rule, 70)).filter(Boolean);
  }
  return out;
}
export async function displaySettings(m) {
  const row = await m.one("SELECT settings FROM kiosk_display WHERE id=1");
  let stored = {};
  try { stored = JSON.parse(row?.settings ?? "{}"); } catch { stored = {}; }
  try { return checkDisplay(stored, () => { throw new Error("invalide"); }); } catch { return { ...DISPLAY_DEFAULTS }; }
}
// Planning du jour pour la borne : horaires d’ouverture et créneaux réservés ou fermés, sans nom de classe.
export async function kioskToday(m, clock) {
  const now = parisClock(clock);
  const [settings, hours, rows] = await Promise.all([
    m.one("SELECT use_hours FROM kiosk_settings WHERE id=1"),
    m.list("SELECT start_min,end_min FROM opening_hours WHERE weekday=? ORDER BY start_min", now.weekday),
    m.list("SELECT day,start_min,end_min,kind,students_allowed FROM planning WHERE day=? ORDER BY start_min", now.day),
  ]);
  return { day:now.day, minute:now.minute, hours:settings?.use_hours === 1 ? hours : [],
    rows:publicPlanning(rows).map(({ start_min, end_min, kind, title }) => ({ start_min, end_min, kind, title })) };
}
