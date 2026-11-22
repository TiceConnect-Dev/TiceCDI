import { Buffer } from "node:buffer";
import { audit } from "./audit.mjs";
import { parisClock, parisMidnight, shiftDay, validDay } from "./calendar.mjs";
const dayMs = 86_400_000;
export const profileFields = ["institution","contact","dpd","purpose","basis","source","recipients","hosting","rights"];
export const maxEnvelopeBytes = 19_000_000;
const backupFormat = "cdi-encrypted";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal:true});
const binary = (value) => Buffer.from(value, "base64");
const base64 = (value) => Buffer.from(value).toString("base64");
const random = (size) => crypto.getRandomValues(new Uint8Array(size));
export const hexDigest = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");

export async function privacySettings(m) {
  const row = await m.one("SELECT * FROM privacy_settings WHERE id=1");
  return {...row, profile:JSON.parse(row.profile), public_planning:Boolean(row.public_planning), purge_enabled:Boolean(row.purge_enabled)};
}
export async function changePrivacy(m, me, body, fail) {
  const before = await privacySettings(m);
  if (!body.profile || typeof body.profile!=="object" || Array.isArray(body.profile)
    || typeof body.public_planning!=="boolean" || typeof body.purge_enabled!=="boolean") fail(400,"Réglages incomplets.");
  const bounds = {retention_days:[0,3650], audit_days:[1,3650], backup_days:[1,365], backup_limit:[1,30]};
  for (const [key,[min,max]] of Object.entries(bounds)) {
    if (!Number.isInteger(body[key]) || body[key]<min || body[key]>max) fail(400,"Une durée ou une limite de conservation est invalide.");
  }
  const profile = {};
  for (const key of profileFields) {
    const value = body.profile[key] ?? "";
    if (typeof value!=="string" || value.length>1500) fail(400,"Chaque champ de la notice accepte au maximum 1 500 caractères.");
    profile[key]=value.trim();
  }
  if (body.purge_enabled && (!before.purge_enabled || body.retention_days<before.retention_days
    || body.audit_days<before.audit_days || body.backup_days<before.backup_days || body.backup_limit<before.backup_limit)
    && body.confirm_retention!==true) fail(409,"Confirmez l’application des nouvelles durées aux données existantes.");
  await m.batch([
    m.stmt("UPDATE privacy_settings SET profile=?,public_planning=?,purge_enabled=?,retention_days=?,audit_days=?,backup_days=?,backup_limit=? WHERE id=1",
      JSON.stringify(profile),+body.public_planning,+body.purge_enabled,body.retention_days,body.audit_days,body.backup_days,body.backup_limit),
    audit(m,me,"confidentialite","Modification des réglages de confidentialité","Établissement",null,
      {purge:body.purge_enabled,journaux_jours:body.audit_days,passages_jours:body.retention_days}),
  ]);
  return {...await privacySettings(m), ...await m.one("SELECT last_success FROM privacy_state WHERE id=1")};
}

export function noticeData(settings) {
  return {profile:settings.profile, retention_days:settings.retention_days, purge_enabled:settings.purge_enabled,
    public_planning:settings.public_planning, audit_days:settings.audit_days, backup_days:settings.backup_days, backup_limit:settings.backup_limit};
}

export function taskStatement(m, settings, clock, op="purge", student=null) {
  const cutoff=settings.purge_enabled ? parisMidnight(shiftDay(parisClock(clock).day,-settings.retention_days)) : 0;
  return m.stmt("INSERT INTO privacy_tasks(op,clock,cutoff,audit_cutoff,backup_cutoff,student_id) VALUES(?,?,?,?,?,?)",
    op,clock,cutoff,settings.purge_enabled ? clock-settings.audit_days*dayMs : 0,
    settings.purge_enabled ? clock-settings.backup_days*dayMs : 0,student);
}
export async function maintain(m, clock=Date.now()) {
  const settings=await privacySettings(m);
  await m.batch([taskStatement(m,settings,clock), m.stmt(`DELETE FROM encrypted_backups WHERE
    (SELECT purge_enabled FROM privacy_settings WHERE id=1)=1 AND id NOT IN
      (SELECT id FROM encrypted_backups ORDER BY created_at DESC,id DESC LIMIT (SELECT backup_limit FROM privacy_settings WHERE id=1))`)]);
  return m.one("SELECT last_success FROM privacy_state WHERE id=1");
}

export async function privateStatistics(m,from,to,clock,fail) {
  if (!validDay(from) || !validDay(to) || from>to || to>parisClock(clock).day || Date.parse(to)-Date.parse(from)>=366*dayMs)
    fail(400,"Choisissez une période de 366 jours maximum qui se termine aujourd’hui ou plus tôt.");
  const rows=await m.list(`WITH all_days AS (
    SELECT day,visits,group_visits,early_exits,observed_ms,distinct_floor FROM daily_statistics WHERE day BETWEEN ? AND ?
    UNION ALL
    SELECT day,count(*),sum(source IN ('classe','groupe')),sum(ended_at IS NOT NULL AND ended_at<expires_at),
      sum(max(0,min(coalesce(ended_at,expires_at),expires_at,?)-starts_at)),count(DISTINCT student_id)
    FROM dated_visits WHERE day BETWEEN ? AND ? GROUP BY day
    ) SELECT day,sum(visits) AS visits,sum(group_visits) AS group_visits,sum(early_exits) AS early_exits,sum(observed_ms) AS observed_ms,max(distinct_floor) AS distinct_floor
      FROM all_days GROUP BY day ORDER BY day`,from,to,clock,from,to);
  const sum=rows.reduce((acc,r)=>({visits:acc.visits+r.visits, observed_ms:acc.observed_ms+r.observed_ms}),{visits:0,observed_ms:0});
  if (!rows.some(r=>r.distinct_floor>=5)) return {from,to,hidden:true,threshold:5,daily:[]};
  // Si une cellule est trop petite, n’afficher que le total de la période.
  const daily=rows.some(r=>r.distinct_floor<5) ? [] : rows.map(({day,visits})=>({day,visits}));
  return {from,to,hidden:false,threshold:5,visits:sum.visits,average:sum.observed_ms/sum.visits/60000,daily};
}

export function scrubLegacy(tables) {
  tables.audit_log=tables.audit_log.map(row=>(row.area==="presences" || (row.area==="seances" && row.action==="Correction d’un appel"))
    ? {...row,target:row.area==="presences"?"Présence":"Fiche d’appel",before_json:null,after_json:null} : row);
  return tables;
}

function password(value, fail) {
  if (typeof value!=="string" || encoder.encode(value).length<12 || encoder.encode(value).length>512)
    fail(400,"Utilisez une phrase secrète de 12 caractères au minimum.");
  return value;
}
async function cryptoKey(secret,salt) {
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:310000},key,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function encryptBackup(text,secret,fail) {
  const salt=random(16), iv=random(12);
  const key=await cryptoKey(password(secret,fail),salt);
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(text));
  return {format:backupFormat,version:1,salt:base64(salt),iv:base64(iv),data:base64(data)};
}
export async function decryptBackup(envelope,secret,fail) {
  if (envelope?.format==="cdi-backup" && envelope.version===1) return envelope;
  if (envelope?.format!==backupFormat || envelope.version!==1 || !["salt","iv","data"].every(k=>typeof envelope[k]==="string"))
    fail(400,"Format de sauvegarde inconnu.");
  const pass=password(secret,fail);
  try {
    const salt=binary(envelope.salt), iv=binary(envelope.iv), data=binary(envelope.data);
    if (salt.length!==16 || iv.length!==12 || data.length<17) throw Error();
    const key=await cryptoKey(pass,salt);
    const text=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data);
    return JSON.parse(decoder.decode(text));
  } catch {
    fail(400,"Phrase secrète incorrecte ou sauvegarde endommagée.");
  }
}

export function checkedPrivacyState(raw,fail) {
  if (raw===undefined) return {archived_before:0,daily:[],erased:[]};
  const number = (value) => Number.isSafeInteger(value) && value>=0;
  if (!raw || !number(raw.archived_before) || raw.archived_before>Date.now()+86_400_000
    || !Array.isArray(raw.daily) || !Array.isArray(raw.erased)
    || raw.erased.some(id=>typeof id!=="string" || !/^[a-f0-9-]{16,64}$/.test(id))
    || raw.daily.some(row=>!row || !validDay(row.day) || !["visits","group_visits","early_exits","observed_ms","distinct_floor"].every(key=>number(row[key]))))
    fail(400,"L’état des purges de la sauvegarde est invalide.");
  return raw;
}

export async function recoveryState(m) {
  const [state,daily,erased]=await m.batch([
    m.stmt("SELECT archived_before FROM privacy_state WHERE id=1"),
    m.stmt("SELECT * FROM daily_statistics ORDER BY day"),
    m.stmt("SELECT student_id FROM erased_students ORDER BY student_id"),
  ]);
  return {archived_before:state.results[0].archived_before,daily:daily.results,erased:erased.results.map(row=>row.student_id)};
}

export function recoveryStatements(m, privacy, clock, settings) {
  return [
    m.stmt("INSERT OR IGNORE INTO erased_students SELECT value FROM json_each(?)",JSON.stringify(privacy.erased)),
    m.stmt(`INSERT OR IGNORE INTO daily_statistics(day,visits,group_visits,early_exits,observed_ms,distinct_floor)
      SELECT value->>'day',value->>'visits',value->>'group_visits',value->>'early_exits',value->>'observed_ms',value->>'distinct_floor' FROM json_each(?)`,JSON.stringify(privacy.daily)),
    m.stmt("UPDATE privacy_state SET archived_before=max(archived_before,?) WHERE id=1",privacy.archived_before),
    taskStatement(m,settings,clock,"restore"),
  ];
}

export async function studentFile(m,id,fail) {
  const student=await m.one(`SELECT s.id,s.first_name,s.last_name,s.external_id,s.code,s.active,s.class_id,c.name AS class_name
    FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?`,id);
  if (!student) fail(404,"Élève introuvable.");
  const [visits,attendance,exclusions,archives]=await Promise.all([
    m.list(`SELECT starts_at,expires_at,ended_at,source,class_name,CASE WHEN ended_at IS NOT NULL THEN 'sortie_enregistree'
      WHEN expires_at<=? THEN 'creneau_expire' ELSE 'en_cours' END AS status FROM visits WHERE student_id=? ORDER BY starts_at DESC`,Date.now(),id),
    m.list(`SELECT a.started_at,a.ended_at,am.status,am.class_name FROM attendance_members am
      JOIN attendance a ON a.id=am.attendance_id WHERE am.student_id=? ORDER BY a.started_at DESC`,id),
    m.list("SELECT reason,until_day,created_at,revoked_at FROM exclusions WHERE student_id=? ORDER BY created_at DESC",id),
    m.list("SELECT year_label,first_name,last_name,class_name FROM school_year_members WHERE student_id=? ORDER BY year_label DESC",id),
  ]);
  return {student, visits,attendance,exclusions,archives};
}

export function publicPlanning(rows) {
  return rows.map(({day,start_min,end_min,kind})=>({day,start_min,end_min,kind:kind==="fermeture"?"fermeture":"reservation",
    title:kind==="fermeture"?"Fermé":"Réservé",class_name:null}));
}
