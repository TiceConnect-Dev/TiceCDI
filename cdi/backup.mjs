import { audit } from "./audit.mjs";
import { scheduleKinds, validDay } from "./calendar.mjs";

const FORMAT = "cdi-backup";
const VERSION = 1;
export const maxBackupBytes = 14_000_000;
const chunkBytes = 450_000;
const encoder = new TextEncoder();

// Les références précèdent les tables qui en dépendent. Le suffixe ? indique une colonne nullable.
const schema = {
  classes: { text: "id name normalized", unique: ["id", "normalized"] },
  students: { text: "id first_name last_name search_name name_key class_id code external_id?", integer: "active",
    unique: ["id", "code", "external_id"], references: {class_id:"classes"} },
  school_groups: { text: "id name normalized", integer: "active", unique: ["id", "normalized"] },
  group_members: { text: "group_id student_id", unique: ["group_id student_id"], references: {group_id:"school_groups",student_id:"students"} },
  planning: { text: "id day title kind class_id? notes group_id?", integer: "start_min end_min", unique: ["id"],
    references: {class_id:"classes",group_id:"school_groups"} },
  attendance: { text: "id plan_id? roster_kind roster_id roster_name title actor", integer: "started_at ended_at? duration",
    unique: ["id", "plan_id"], references: {plan_id:"planning"} },
  attendance_members: { text: "attendance_id student_id first_name last_name class_name status", unique: ["attendance_id student_id"],
    references: {attendance_id:"attendance",student_id:"students"} },
  visits: { text: "id student_id source class_name? attendance_id?", integer: "starts_at expires_at ended_at?", unique: ["id"],
    references: {student_id:"students",attendance_id:"attendance"} },
  exclusions: { text: "id student_id reason until_day author", integer: "created_at revoked_at?", unique: ["id"], references: {student_id:"students"} },
  kiosk_settings: { text: "message", integer: "id is_open allow_second_hour use_hours capacity? hide_weekend", unique: ["id"] },
  opening_hours: { integer: "weekday start_min end_min", unique: ["weekday start_min"] },
  school_year: { text: "label transition_id? actor", integer: "opened_at closed_at?", unique: ["label"] },
  school_year_members: { text: "year_label student_id first_name last_name class_name", unique: ["year_label student_id"],
    references: {year_label:"school_year",student_id:"students"} },
  audit_log: { text: "id actor area action target before_json? after_json?", integer: "at", unique: ["id"] },
};

const tables = Object.entries(schema).map(([name, spec]) => {
  const columns = ["text", "integer"].flatMap(type => (spec[type] ?? "").split(" ").filter(Boolean).map(key => ({
    key: key.replace(/\?$/, ""), nullable: key.endsWith("?"), type,
  })));
  return {name, columns, columnList:columns.map(({key})=>key).join(","), unique:spec.unique.map(key=>key.split(" ")), references:spec.references ?? {}};
});
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function flag(value) { return value === 0 || value === 1; }
function validSpan(row) { return row.start_min >= 0 && row.start_min < row.end_min && row.end_min <= 1440; }
function validAudit(raw) {
  if (raw === null) return true;
  try { return object(JSON.parse(raw)); } catch { return false; }
}
const validRow = {
  students: row => flag(row.active),
  school_groups: row => flag(row.active),
  planning: row => validDay(row.day) && validSpan(row)
    && scheduleKinds.includes(row.kind),
  attendance: row => ["classe","groupe"].includes(row.roster_kind) && row.duration >= 5 && row.duration <= 240,
  attendance_members: row => ["present","retard","absent","excuse","attente","exclu"].includes(row.status),
  visits: row => row.starts_at < row.expires_at && ["individuel","classe","groupe"].includes(row.source),
  exclusions: row => validDay(row.until_day),
  kiosk_settings: row => row.id === 1 && [row.is_open,row.allow_second_hour,row.use_hours,row.hide_weekend].every(flag)
    && (row.capacity === null || (row.capacity >= 1 && row.capacity <= 1000)),
  opening_hours: row => row.weekday >= 1 && row.weekday <= 7 && validSpan(row),
  audit_log: row => validAudit(row.before_json) && validAudit(row.after_json),
};

function validColumn(row, {key, nullable, type}) {
  if (!Object.hasOwn(row, key)) return false;
  const value = row[key];
  if (value === null) return nullable;
  return type === "integer" ? Number.isSafeInteger(value) : typeof value === "string";
}

export async function exportBackup(m, clock, fail) {
  const data = await m.batch(tables.map(({name,columnList})=>m.stmt(`SELECT ${columnList} FROM ${name}`)));
  const backup = {
    format:FORMAT, version:VERSION, created_at:new Date(clock).toISOString(),
    tables:Object.fromEntries(tables.map(({name},index)=>[name,data[index].results])),
  };
  const serialized = JSON.stringify(backup);
  if (encoder.encode(serialized).byteLength > maxBackupBytes) fail(413, "Les données dépassent la taille maximale d’une sauvegarde depuis l’administration.");
  return serialized;
}

export function inspectBackup(backup, fail) {
  if (!object(backup) || backup.format !== FORMAT || backup.version !== VERSION
    || typeof backup.created_at !== "string" || !Number.isFinite(Date.parse(backup.created_at))
    || !object(backup.tables) || Object.keys(backup.tables).length !== tables.length) {
    fail(400, "Le fichier n’est pas une sauvegarde CDI dans un format pris en charge.");
  }
  const counts = {};
  const keys = new Map();
  for (const {name,columns,unique,references} of tables) {
    const rows = backup.tables[name];
    if (!Array.isArray(rows)) fail(400, "La sauvegarde est incomplète.");
    const indexes = unique.map(fields=>({fields,seen:new Set()}));
    for (const row of rows) {
      if (!object(row) || Object.keys(row).length !== columns.length || !columns.every(column=>validColumn(row,column))
        || (validRow[name] && !validRow[name](row))) fail(400, `Données invalides dans la rubrique « ${name} ».`);
      for (const [field, target] of Object.entries(references)) {
        if (row[field] !== null && !keys.get(target).has(JSON.stringify([row[field]]))) {
          fail(400, `Référence introuvable dans la rubrique « ${name} ».`);
        }
      }
      for (const {fields,seen} of indexes) {
        const values = fields.map(field=>row[field]);
        if (values.includes(null)) continue;
        const key = JSON.stringify(values);
        if (seen.has(key)) fail(400, `Des données sont en double dans la rubrique « ${name} ».`);
        seen.add(key);
      }
    }
    keys.set(name, indexes[0].seen);
    counts[name] = rows.length;
  }
  return {created_at:backup.created_at, counts};
}

export async function restoreBackup(m, me, backup, summary, fail) {
  const statements = [...tables].reverse().map(({name})=>m.stmt(`DELETE FROM ${name}`));
  for (const {name,columns,columnList} of tables) {
    const extract = columns.map(({key})=>`json_extract(value,'$.${key}')`).join(",");
    const sql = `INSERT INTO ${name} (${columnList}) SELECT ${extract} FROM json_each(?)`;
    let chunk = [];
    let bytes = 2;
    for (const row of backup.tables[name]) {
      const data = JSON.stringify(row);
      const size = encoder.encode(data).byteLength + 1;
      if (size > chunkBytes - 2) fail(400, `Une ligne de la rubrique « ${name} » est trop volumineuse.`);
      if (bytes + size > chunkBytes) {
        statements.push(m.stmt(sql, "[" + chunk.join(",") + "]"));
        chunk = [];
        bytes = 2;
      }
      chunk.push(data);
      bytes += size;
    }
    if (chunk.length) statements.push(m.stmt(sql, "[" + chunk.join(",") + "]"));
  }
  statements.push(audit(m, me, "sauvegarde", "Restauration d’une sauvegarde", "Données du CDI", null, {
    sauvegarde_du:summary.created_at,
    élèves:summary.counts.students,
    présences:summary.counts.visits,
    créneaux:summary.counts.planning,
  }));
  await m.batch(statements);
}
