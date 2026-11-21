import { audit } from "./audit.mjs";

export const dayLength = 86_400_000;
export const hourLength = 3_600_000;
export function presenceDeadline(clock, slots = 1) {
  return (Math.floor(clock / hourLength) + slots) * hourLength;
}
const paris = new Intl.DateTimeFormat("en-GB", {
  timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit",
  hour:"2-digit", minute:"2-digit", hourCycle:"h23",
});
function stamp(day) { return Date.parse(day + "T00:00:00Z"); }
export function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= "2000-01-01" && day <= "2199-12-31"
    && Number.isFinite(stamp(day)) && new Date(stamp(day)).toISOString().slice(0, 10) === day;
}
export function shiftDay(day, offset) { return new Date(stamp(day) + offset * dayLength).toISOString().slice(0,10); }
export function weekday(day) { return ((new Date(stamp(day)).getUTCDay() + 6) % 7) + 1; }
export function parisClock(ms = Date.now()) {
  const p = Object.fromEntries(paris.formatToParts(ms).map(({type,value}) => [type,value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return { day, weekday:weekday(day), minute };
}
function offset(ms) {
  const local = parisClock(ms);
  return stamp(local.day) + local.minute * 60_000 - Math.floor(ms / 60_000) * 60_000;
}
export function parisMidnight(day) {
  const local = stamp(day);
  return local - offset(local - offset(local));
}
export function timeSegments(start, end) {
  const spans = [];
  let from = start;
  let shift = offset(start);
  for (let point = Math.min(start + dayLength, end); ; point = Math.min(point + dayLength, end)) {
    const next = offset(point);
    if (shift !== next) {
      let lo = point - dayLength, hi = point;
      while (hi - lo > 60_000) {
        const midpoint = Math.floor((lo + hi) / 120_000) * 60_000;
        if (offset(midpoint) === shift) lo = midpoint;
        else hi = midpoint;
      }
      spans.push({ start:from, end:hi, offset:shift });
      from = hi;
      shift = next;
    }
    if (point === end) break;
  }
  if (from < end) spans.push({ start:from, end, offset:shift });
  return spans;
}
export const scheduleKinds = ["cours", "atelier", "reservation", "fermeture", "autre"];
const manualClosed = "Les inscriptions au CDI sont fermées pour le moment.";
const hoursClosed = "Le CDI est fermé selon les horaires d’ouverture.";
const eventClosed = "Le CDI est fermé exceptionnellement sur ce créneau.";

export function kioskClosure(clock) {
  const {day,weekday,minute} = parisClock(clock);
  return { sql:`SELECT CASE
    WHEN EXISTS (SELECT 1 FROM kiosk_settings WHERE id=1 AND is_open=0) THEN ?
    WHEN EXISTS (SELECT 1 FROM planning WHERE day=? AND kind='fermeture' AND start_min<=? AND end_min>?) THEN ?
    WHEN EXISTS (SELECT 1 FROM kiosk_settings WHERE id=1 AND use_hours=1)
      AND NOT EXISTS (SELECT 1 FROM opening_hours WHERE weekday=? AND start_min<=? AND end_min>?) THEN ?
    ELSE '' END AS reason`, params:[manualClosed, day, minute, minute, eventClosed, weekday, minute, minute, hoursClosed] };
}

export function normalizeHours(rows, fail) {
  if (!Array.isArray(rows) || rows.length > 28) fail(400,"Saisissez au maximum quatre plages par jour.");
  if (rows.some(row => !row || !Number.isInteger(row.weekday) || row.weekday<1 || row.weekday>7
    || !Number.isInteger(row.start_min) || !Number.isInteger(row.end_min)
    || row.start_min<0 || row.end_min>1440 || row.end_min<=row.start_min)) fail(400,"Chaque fermeture doit avoir lieu après l’ouverture.");
  const sorted = rows.toSorted((a,b) => a.weekday-b.weekday || a.start_min-b.start_min);
  for (let d=1;d<=7;d++) {
    const windows = sorted.filter(row => row.weekday===d);
    if (windows.length>4 || windows.some((row,i) => i>0 && row.start_min<windows[i-1].end_min)) fail(400,"Vérifiez les plages de chaque jour. Elles doivent être distinctes et sans chevauchement.");
  }
  return sorted.map(({weekday,start_min,end_min})=>({weekday,start_min,end_min}));
}

export async function openingHours(m) {
  const [settings,rows] = await Promise.all([
    m.one("SELECT use_hours,hide_weekend FROM kiosk_settings WHERE id=1"),
    m.list("SELECT weekday,start_min,end_min FROM opening_hours ORDER BY weekday,start_min"),
  ]);
  return { use_hours: settings?.use_hours === 1, hide_weekend:settings?.hide_weekend===1, hours:rows };
}

export function saveOpeningHours(m, enabled, hours, me, before) {
  return m.batch([
    m.stmt("INSERT INTO kiosk_settings(id,use_hours) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET use_hours=excluded.use_hours", Number(enabled)),
    m.stmt("DELETE FROM opening_hours"),
    m.stmt(`INSERT INTO opening_hours
      SELECT value->>'weekday',value->>'start_min',value->>'end_min' FROM json_each(?)`, JSON.stringify(hours)),
    audit(m,me,"horaires","Modification des horaires","Horaires d’ouverture",before,{ use_hours:enabled,hours }),
  ]);
}
const details = `SELECT p.id,p.day,p.start_min,p.end_min,p.title,p.kind,COALESCE(c.name,g.name) AS class_name`;
export async function weekPlanning(m, start, internal = false) {
  const [data, rows] = await Promise.all([
    openingHours(m),
    m.list(`${details}${internal ? ",p.class_id,p.group_id,p.notes,(SELECT id FROM attendance WHERE plan_id=p.id) AS attendance_id" : ""} FROM planning p LEFT JOIN classes c ON c.id=p.class_id
      LEFT JOIN school_groups g ON g.id=p.group_id WHERE p.day>=? AND p.day<? ORDER BY p.day,p.start_min`, start, shiftDay(start,7)),
  ]);
  return { ...data, rows, start, end:shiftDay(start,6), now:parisClock() };
}
export async function changeSlot(m, item, body, fail, nameLabel, me) {
  const {day,start_min:start,end_min:end,kind} = body;
  if (!validDay(day) || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end>1440 || end-start<5) fail(400,"Indiquez une date et une plage d’au moins cinq minutes.");
  if (!scheduleKinds.includes(kind)) fail(400,"Sélectionnez un type de créneau.");
  const title = nameLabel(body.title,"Le titre",80);
  const classId = typeof body.class_id==="string" && body.class_id ? body.class_id : null;
  const groupId = typeof body.group_id==="string" && body.group_id ? body.group_id : null;
  if (classId && groupId) fail(400,"Choisissez soit une classe, soit un groupe.");
  const notes = typeof body.notes==="string" ? body.notes.trim() : "";
  if (notes.length>600) fail(400,"Les notes peuvent contenir jusqu’à 600 caractères.");
  if (classId && !await m.one("SELECT id FROM classes WHERE id=?",classId)) fail(400,"La classe sélectionnée est introuvable.");
  const before = item ? await m.one("SELECT day,start_min,end_min,title,kind,class_id,group_id,notes FROM planning WHERE id=?",item) : null;
  if (item && !before) fail(404,"Créneau introuvable.");
  if (groupId && groupId!==before?.group_id && !await m.one("SELECT id FROM school_groups WHERE id=? AND active=1",groupId)) fail(400,"Le groupe sélectionné est indisponible.");
  const free = "NOT EXISTS (SELECT 1 FROM planning WHERE day=? AND start_min<? AND end_min>? AND id<>?)";
  const ident = item ?? crypto.randomUUID();
  const values = [day,start,end,title,kind,classId,groupId,notes];
  const statement = item
    ? m.stmt(`UPDATE planning SET day=?,start_min=?,end_min=?,title=?,kind=?,class_id=?,group_id=?,notes=? WHERE id=? AND ${free}`,...values,ident,day,end,start,ident)
    : m.stmt(`INSERT INTO planning (id,day,start_min,end_min,title,kind,class_id,group_id,notes) SELECT ?,?,?,?,?,?,?,?,? WHERE ${free}`,ident,...values,day,end,start,"");
  const after={day,start_min:start,end_min:end,title,kind,class_id:classId,group_id:groupId,notes};
  const [result]=await m.batch([statement,audit(m,me,"planning",item?"Modification du créneau":"Création du créneau",title,before,after,true)]);
  if (!result.meta.changes) fail(409,"Un créneau occupe déjà tout ou partie de cette plage.");
  return { ok:true };
}
export async function duplicateWeek(m,start,me) {
  const end = shiftDay(start,7);
  const [count, copied] = await m.batch([
    m.stmt("SELECT count(*) AS total FROM planning WHERE day>=? AND day<?",start,end),
    m.stmt(`INSERT INTO planning (id,day,start_min,end_min,title,kind,class_id,notes,group_id)
      SELECT lower(hex(randomblob(16))),date(p.day,'+7 days'),p.start_min,p.end_min,p.title,p.kind,p.class_id,p.notes,p.group_id
      FROM planning p WHERE p.day>=? AND p.day<?
      AND NOT EXISTS (SELECT 1 FROM planning q WHERE q.day=date(p.day,'+7 days')
        AND q.start_min<p.end_min AND q.end_min>p.start_min)`,start,end),
    audit(m,me,"planning","Copie de la semaine",start,null,{ semaine:shiftDay(start,7) },true),
  ]);
  return { added:copied.meta.changes, skipped:count.results[0].total-copied.meta.changes };
}
