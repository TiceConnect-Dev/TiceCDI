import { audit } from "./audit.mjs";

const yearPattern=/^(20\d{2})-(20\d{2}|2100)$/;
function nextYear(value) {
  const start=Number(value.slice(0,4))+1;
  return start+"-"+(start+1);
}
function validYear(value) {
  const match=typeof value==="string" ? value.match(yearPattern) : null;
  return Boolean(match && Number(match[2])===Number(match[1])+1);
}
export function academicYear(day) {
  const year=Number(day.slice(0,4))-(Number(day.slice(5,7))<9?1:0);
  return year+"-"+(year+1);
}
export async function years(m, day) {
  const rows=await m.list(`SELECT y.label,y.opened_at,y.closed_at,y.actor,
    (SELECT count(*) FROM school_year_members a WHERE a.year_label=y.label) AS total
    FROM school_year y ORDER BY y.label DESC`);
  const current=rows.find(row=>row.closed_at===null)?.label ?? academicYear(day);
  return { current, next:nextYear(current), initialized:Boolean(rows.length), rows };
}
export async function archiveRows(m, label, fail) {
  if (!validYear(label) || !await m.one("SELECT label FROM school_year WHERE label=? AND closed_at IS NOT NULL",label)) fail(404,"Archive d’année scolaire introuvable.");
  return m.list("SELECT first_name,last_name,class_name FROM school_year_members WHERE year_label=? ORDER BY last_name,first_name,student_id",label);
}

const rosterSql = `SELECT COALESCE(json_group_array(json_array(id,active,external_id,class_id,name_key)), '[]') AS snapshot
  FROM (SELECT id,active,external_id,class_id,name_key FROM students ORDER BY id)`;
export async function rollover(m, me, body, clock, day, helpers) {
  const {fail, studentData, normalize, className, digest, barcode}=helpers;
  const {from,to,rows,token}=body;
  if (!validYear(from) || !validYear(to) || nextYear(from)!==to) fail(400,"Indiquez deux années scolaires consécutives (ex. 2026-2027 puis 2027-2028).");
  const current=await years(m,day);
  if (current.initialized && from!==current.current) fail(409,"L’année active a changé. Chargez un nouvel aperçu.");
  if (!Array.isArray(rows) || !rows.length || rows.length>5000) fail(400,"Le fichier complet des élèves doit contenir de 1 à 5 000 lignes.");
  const cleanRows=[];
  const errors=[];
  const keys=new Set();
  for (const [index,raw] of rows.entries()) {
    try {
      const s=studentData(raw??{});
      if (!s.external_id) fail(400,"Identifiant externe obligatoire pour le passage d’année.");
      if (keys.has(s.external_id)) fail(400,"Identifiant externe en double dans le fichier.");
      const class_name=className(raw.class_name);
      keys.add(s.external_id);
      cleanRows.push({...s,class_name,class_key:normalize(class_name)});
    } catch (error) {
      if (!error.status) throw error;
      errors.push({line:index+2,message:error.message});
    }
  }
  if (errors.length) return { errors };
  const [snapshot,currentStudents]=await Promise.all([
    m.one(rosterSql),
    m.list(`SELECT s.first_name,s.last_name,s.active,s.external_id,c.name AS class_name,c.normalized AS class_key
      FROM students s JOIN classes c ON c.id=s.class_id ORDER BY s.last_name,s.first_name,s.id`),
  ]);
  const existing = new Map(currentStudents.filter(row=>row.external_id).map(row=>[row.external_id,row]));
  const leaving=currentStudents.filter(row=>row.active && !keys.has(row.external_id));
  const newcomers=cleanRows.filter(row=>!existing.has(row.external_id));
  const returning=cleanRows.filter(row=>existing.has(row.external_id)&&!existing.get(row.external_id).active);
  const moves=cleanRows.filter(row=>existing.has(row.external_id)&&row.class_key!==existing.get(row.external_id).class_key);
  const counts={
    rookies:newcomers.length, retained:cleanRows.length-newcomers.length, reactivated:returning.length,
    archived:leaving.length, moved:moves.length, total:cleanRows.length,
  };
  const verification=await digest(JSON.stringify([from,to,current.initialized,snapshot.snapshot,cleanRows]));
  if (!token) {
    const slim=({first_name,last_name,class_name})=>({first_name,last_name,class_name});
    return {
      token:verification,counts,errors:[], leaving:leaving.slice(0,50).map(slim),
      newcomers:newcomers.slice(0,25).map(slim),
      moves:moves.slice(0,25).map(row=>({...slim(row),before:existing.get(row.external_id).class_name})),
    };
  }
  if (verification!==token) fail(409,"Les fiches ou le fichier ont changé. Refaites l’aperçu avant d’appliquer.");
  const operation=crypto.randomUUID();
  const guard="EXISTS(SELECT 1 FROM school_year WHERE label=? AND transition_id=?)";
  const entry=cleanRows.map(row=>({...row,id:crypto.randomUUID(),code:barcode()}));
  const classes=[...new Map(cleanRows.map(row=>[row.class_key,{name:row.class_name,normalized:row.class_key}])).values()];
  const cohort=JSON.stringify(entry);
  const params=[to,operation];
  const outcome=await m.batch([
    m.stmt(`INSERT INTO school_year (label,opened_at,actor) SELECT ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM school_year) AND (${rosterSql.replace(" AS snapshot","")})=?`,from,clock,me.name,snapshot.snapshot),
    m.stmt(`INSERT OR IGNORE INTO school_year(label,transition_id,opened_at,actor)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM school_year WHERE label=? AND closed_at IS NULL)
      AND (${rosterSql.replace(" AS snapshot","")})=?`,to,operation,clock,me.name,from,snapshot.snapshot),
    audit(m,me,"annees","Passage à la nouvelle année",to,{ année:from },counts,true),
    m.stmt(`INSERT INTO school_year_members (year_label,student_id,first_name,last_name,class_name)
      SELECT ?,s.id,s.first_name,s.last_name,c.name FROM students s JOIN classes c ON c.id=s.class_id
      WHERE s.active=1 AND ${guard}`,from,...params),
    m.stmt(`UPDATE school_year SET closed_at=? WHERE label=? AND ${guard}`,clock,from,...params),
    m.stmt(`INSERT OR IGNORE INTO classes SELECT lower(hex(randomblob(16))),value->>'name',value->>'normalized'
      FROM json_each(?) WHERE ${guard}`,JSON.stringify(classes),...params),
    m.stmt(`UPDATE students SET active=0 WHERE active=1
      AND (external_id IS NULL OR external_id NOT IN (SELECT value->>'external_id' FROM json_each(?))) AND ${guard}`,cohort,...params),
    m.stmt(`UPDATE visits SET ended_at=? WHERE ended_at IS NULL AND expires_at>? AND ${guard}
      AND student_id IN (SELECT id FROM students WHERE active=0)`,clock,clock,...params),
    m.stmt(`INSERT INTO students (id,first_name,last_name,search_name,name_key,class_id,code,external_id,active)
      SELECT j.value->>'id',j.value->>'first_name',j.value->>'last_name',j.value->>'search_name',j.value->>'name_key',c.id,j.value->>'code',j.value->>'external_id',1
      FROM json_each(?) j JOIN classes c ON c.normalized=j.value->>'class_key' WHERE ${guard}
      ON CONFLICT(external_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,search_name=excluded.search_name,
      name_key=excluded.name_key,class_id=excluded.class_id,active=1`,cohort,...params),
  ]);
  if (!outcome[1].meta.changes) fail(409,"La liste ou l’année a changé pendant l’opération. Rechargez l’aperçu.");
  return { ok:true,current:to,counts };
}
