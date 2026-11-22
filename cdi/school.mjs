import { audit } from "./audit.mjs";
import { seatsSql } from "./capacity.mjs";
import { parisClock, presenceDeadline } from "./calendar.mjs";

const activeVisit = "v.ended_at IS NULL AND v.expires_at>?";
const excluded = "SELECT 1 FROM exclusions x WHERE x.student_id=s.id AND x.revoked_at IS NULL AND x.until_day>=?";
const rosterFilter = "(?='classe' AND s.class_id=?) OR (?='groupe' AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=? AND gm.student_id=s.id))";
const statuses = ["present","retard","absent","excuse"];

function ids(value, fail, max=500) {
  if (!Array.isArray(value) || value.length>max || value.some(x=>typeof x!=="string" || !x || x.length>80)) {
    fail(400,"Sélectionnez des fiches élèves valides.");
  }
  return [...new Set(value)];
}

export async function groups(m) {
  return m.list(`SELECT g.id,g.name,g.active,count(s.id) AS total FROM school_groups g
    LEFT JOIN group_members gm ON gm.group_id=g.id LEFT JOIN students s ON s.id=gm.student_id AND s.active=1
    GROUP BY g.id ORDER BY g.active DESC,g.normalized`);
}

export async function roster(m, kind, ident, fail) {
  const isClass = kind==="classe";
  if ((!isClass && kind!=="groupe") || typeof ident!=="string" || !ident) fail(400,"Choisissez une classe ou un groupe.");
  const group=await m.one(isClass?"SELECT id,name FROM classes WHERE id=?":"SELECT id,name FROM school_groups WHERE id=? AND active=1",ident);
  if (!group) fail(404,"La classe ou le groupe n’est pas disponible.");
  const rows=await m.list(`SELECT s.id,s.first_name,s.last_name,c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id
    WHERE s.active=1 AND (${rosterFilter}) ORDER BY s.last_name,s.first_name,s.id`,kind,ident,kind,ident);
  return { group,rows };
}

export async function members(m, ident, fail) {
  if (!await m.one("SELECT id FROM school_groups WHERE id=?",ident)) fail(404,"Groupe introuvable.");
  return m.list(`SELECT s.id,s.first_name,s.last_name,c.name AS class_name,s.active FROM group_members g
    JOIN students s ON s.id=g.student_id JOIN classes c ON c.id=s.class_id WHERE g.group_id=?
    ORDER BY s.active DESC,s.last_name,s.first_name`,ident);
}

export async function changeGroup(m, me, ident, body, fail, label, normalize) {
  const name=label(body.name,"Le nom du groupe",65);
  const key=normalize(name);
  const groupId=ident ?? crypto.randomUUID();
  const before=ident ? await m.one("SELECT id,name,active FROM school_groups WHERE id=?",ident) : null;
  if (ident && !before) fail(404,"Groupe introuvable.");
  if (await m.one("SELECT id FROM school_groups WHERE normalized=? AND id<>?",key,groupId)) fail(409,"Un groupe porte déjà ce nom.");
  const selected=ids(body.student_ids,fail);
  const encoded=JSON.stringify(selected);
  const existing=await m.one("SELECT count(*) AS total FROM students WHERE id IN (SELECT value FROM json_each(?))",encoded);
  if (existing.total!==selected.length) fail(409,"Actualisez la liste des élèves du groupe.");
  const previous=ident ? await members(m,ident,fail) : [];
  const active=body.active===false ? 0 : 1;
  await m.batch([
    m.stmt(`INSERT INTO school_groups(id,name,normalized,active) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized=excluded.normalized,active=excluded.active`,groupId,name,key,active),
    m.stmt("DELETE FROM group_members WHERE group_id=?",groupId),
    m.stmt("INSERT INTO group_members SELECT ?,value FROM json_each(?)",groupId,encoded),
    audit(m,me,"groupes",ident?"Modification du groupe":"Création du groupe",name,
      before ? { nom:before.name, actif:Boolean(before.active), effectif:previous.length } : null,
      { nom:name, actif:Boolean(active), effectif:selected.length }),
  ]);
  return { id:groupId };
}

export async function sessionsList(m, clock) {
  return m.list(`SELECT a.*,count(am.student_id) AS total,sum(CASE WHEN am.status IN('present','retard') THEN 1 ELSE 0 END) AS present,
    sum(CASE WHEN am.status='absent' THEN 1 ELSE 0 END) AS absent,
    sum(CASE WHEN am.status='attente' THEN 1 ELSE 0 END) AS waiting,
    (SELECT count(*) FROM visits v WHERE v.attendance_id=a.id AND ${activeVisit}) AS active
    FROM attendance a LEFT JOIN attendance_members am ON am.attendance_id=a.id GROUP BY a.id
    ORDER BY a.started_at DESC,a.id DESC LIMIT 200`,clock);
}

export async function sessionDetail(m, ident, clock, fail) {
  const session=await m.one("SELECT * FROM attendance WHERE id=?",ident);
  if (!session) fail(404,"Fiche d’appel introuvable.");
  const rows=await m.list(`SELECT am.*,
    EXISTS(SELECT 1 FROM visits v WHERE v.attendance_id=am.attendance_id AND v.student_id=am.student_id AND ${activeVisit}) AS active,
    (SELECT min(v.starts_at) FROM visits v WHERE v.attendance_id=am.attendance_id AND v.student_id=am.student_id) AS arrived_at
    FROM attendance_members am WHERE am.attendance_id=? ORDER BY am.last_name,am.first_name,am.student_id`,clock,ident);
  return { session,rows };
}

export async function startSession(m, me, body, clock, fail, label) {
  const {kind,roster_id:rosterId,duration,plan_id:planId=null,request_id:requestId}=body;
  if (typeof requestId!=="string" || !/^[a-f0-9-]{36}$/i.test(requestId) || !Number.isInteger(duration) || duration<5 || duration>240) fail(400,"Indiquez une durée de 5 à 240 minutes.");
  const previous=await m.one("SELECT id FROM attendance WHERE id=? OR (? IS NOT NULL AND plan_id=?)",requestId,planId,planId);
  if (previous) return { ...await sessionDetail(m,previous.id,clock,fail),reused:true };
  const {group,rows}=await roster(m,kind,rosterId,fail);
  if (!rows.length) fail(409,"Ce groupe ne contient aucun élève actif.");
  const selected=ids(body.student_ids,fail);
  const valid=new Set(rows.map(row=>row.id));
  if (selected.some(id=>!valid.has(id))) fail(409,"La composition a changé. Rouvrez la fiche d’appel.");
  const local=parisClock(clock);
  const plan=planId===null ? null : await m.one("SELECT id,day,title,class_id,group_id,kind FROM planning WHERE id=?",planId);
  if (planId!==null && (!plan || plan.day!==local.day || plan.kind==="fermeture" || (kind==="classe" ? plan.class_id : plan.group_id)!==rosterId)) {
    fail(409,"Ce créneau ne correspond pas à un cours ou une activité du jour pour ce groupe.");
  }
  const title=plan?.title ?? (typeof body.title==="string" && body.title.trim() ? label(body.title,"Le titre de la séance",80) : group.name);
  const expires=presenceDeadline(clock,Math.ceil(duration/60));
  const selection=JSON.stringify(selected);
  const statements=[
    m.stmt("INSERT OR IGNORE INTO attendance (id,plan_id,roster_kind,roster_id,roster_name,title,started_at,duration,actor) VALUES (?,?,?,?,?,?,?,?,?)",
      requestId,planId,kind,rosterId,group.name,title,clock,duration,me.name),
    audit(m,me,"seances","Ouverture de la fiche d’appel",title,null,{ groupe:group.name, effectif:rows.length, cochés:selected.length },true),
    m.stmt(`INSERT OR IGNORE INTO attendance_members
      SELECT ?,s.id,s.first_name,s.last_name,c.name,CASE WHEN s.id IN (SELECT value FROM json_each(?)) THEN 'attente' ELSE 'absent' END
      FROM students s JOIN classes c ON c.id=s.class_id WHERE s.active=1 AND (${rosterFilter})
      AND EXISTS (SELECT 1 FROM attendance a WHERE a.id=? AND a.started_at=? AND a.ended_at IS NULL)`,
      requestId,selection,kind,rosterId,kind,rosterId,requestId,clock),
    m.stmt(`UPDATE attendance_members AS am SET status='exclu' WHERE attendance_id=? AND status='attente'
      AND EXISTS (SELECT 1 FROM students s WHERE s.id=am.student_id AND EXISTS (${excluded}))`,requestId,local.day),
    m.stmt(`UPDATE visits AS v SET attendance_id=? WHERE ${activeVisit}
      AND (v.attendance_id IS NULL OR EXISTS(SELECT 1 FROM attendance a WHERE a.id=v.attendance_id AND a.ended_at IS NOT NULL))
      AND v.student_id IN (SELECT student_id FROM attendance_members WHERE attendance_id=? AND status='attente')`,requestId,clock,requestId),
    m.stmt(`INSERT INTO visits (id,student_id,starts_at,expires_at,source,class_name,attendance_id)
      SELECT lower(hex(randomblob(16))),am.student_id,?,?,?,am.class_name,am.attendance_id FROM attendance_members am
      WHERE am.attendance_id=? AND am.status='attente'
      AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.student_id=am.student_id AND ${activeVisit})
      ORDER BY am.last_name,am.first_name,am.student_id LIMIT ${seatsSql}`,
      clock,expires,kind==="groupe"?"groupe":"classe",requestId,clock,clock),
    m.stmt(`UPDATE attendance_members AS am SET status='present' WHERE attendance_id=? AND status='attente'
      AND EXISTS (SELECT 1 FROM visits v WHERE v.student_id=am.student_id AND ${activeVisit})`,requestId,clock),
  ];
  const [insert]=await m.batch(statements);
  if (!insert.meta.changes) {
    const existing=await m.one("SELECT id FROM attendance WHERE id=? OR (? IS NOT NULL AND plan_id=?)",requestId,planId,planId);
    if (!existing) fail(409,"Cette séance a changé. Rechargez le planning.");
    return { ...await sessionDetail(m,existing.id,clock,fail),reused:true };
  }
  return sessionDetail(m,requestId,clock,fail);
}

export async function changeCall(m, me, ident, body, clock, fail) {
  const status=body.status;
  if (!statuses.includes(status) || typeof body.student_id!=="string") fail(400,"Choisissez un statut valide.");
  const member=await m.one(`SELECT am.*,a.title,a.ended_at,a.started_at,a.duration,a.roster_kind FROM attendance_members am
    JOIN attendance a ON a.id=am.attendance_id WHERE am.attendance_id=? AND am.student_id=?`,ident,body.student_id);
  if (!member) fail(404,"Élève introuvable sur cette fiche.");
  if (member.status===status) return sessionDetail(m,ident,clock,fail);
  const arriving=["present","retard"].includes(status);
  const deadline=presenceDeadline(member.started_at,Math.ceil(member.duration/60));
  const sessionOpen = "EXISTS (SELECT 1 FROM attendance a WHERE a.id=? AND a.ended_at IS NULL)";
  const open = `(${sessionOpen} AND ?>?)`;
  const openArgs=[ident,deadline,clock];
  const eligible=`SELECT s.id FROM students s WHERE s.id=? AND s.active=1 AND NOT EXISTS (${excluded})`;
  const day=parisClock(clock).day;
  const statements=[];
  if (arriving) {
    statements.push(
      m.stmt(`UPDATE visits AS v SET attendance_id=? WHERE v.student_id IN (${eligible}) AND ${activeVisit}
        AND ${open} AND (v.attendance_id IS NULL OR EXISTS(SELECT 1 FROM attendance a WHERE a.id=v.attendance_id AND a.ended_at IS NOT NULL))`,
        ident,member.student_id,day,clock,...openArgs),
      m.stmt(`INSERT INTO visits (id,student_id,starts_at,expires_at,source,class_name,attendance_id)
        SELECT ?,s.id,?,?,?, ?,? FROM (${eligible}) s WHERE ${open}
        AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.student_id=s.id AND ${activeVisit}) AND ${seatsSql}>0`,
        crypto.randomUUID(),clock,deadline,member.roster_kind==="groupe"?"groupe":"classe",
        member.class_name,ident,member.student_id,day,...openArgs,clock,clock),
    );
  } else {
    statements.push(m.stmt(`UPDATE visits AS v SET ended_at=? WHERE v.attendance_id=? AND v.student_id=? AND ${activeVisit} AND ${sessionOpen}`,
      clock,ident,member.student_id,clock,ident));
  }
  const guard=arriving ? `AND (NOT ${open} OR (EXISTS(${eligible}) AND EXISTS(SELECT 1 FROM visits v WHERE v.student_id=? AND ${activeVisit})))` : "";
  const args=arriving ? [...openArgs,member.student_id,day,member.student_id,clock] : [];
  statements.push(
    m.stmt(`UPDATE attendance_members SET status=? WHERE attendance_id=? AND student_id=? ${guard}`,status,ident,member.student_id,...args),
    audit(m,me,"seances","Correction d’un appel","Fiche d’appel",{ statut:member.status },{ statut:status },true),
  );
  const outcome=await m.batch(statements);
  if (!outcome.at(-2).meta.changes) fail(409,"L’arrivée n’a pas été enregistrée. Vérifiez la jauge, l’exclusion ou la fiche de l’élève.");
  return sessionDetail(m,ident,clock,fail);
}

export async function finishSession(m, me, ident, body, clock, fail) {
  const keep=ids(body.keep_student_ids??[],fail);
  const session=await m.one("SELECT * FROM attendance WHERE id=?",ident);
  if (!session) fail(404,"Fiche d’appel introuvable.");
  const [leavers]=await m.batch([
    m.stmt(`UPDATE visits AS v SET ended_at=? WHERE v.attendance_id=? AND ${activeVisit}
      AND v.student_id NOT IN (SELECT value FROM json_each(?))
      AND EXISTS (SELECT 1 FROM attendance a WHERE a.id=? AND a.ended_at IS NULL)`,clock,ident,clock,JSON.stringify(keep),ident),
    m.stmt("UPDATE attendance SET ended_at=? WHERE id=? AND ended_at IS NULL",clock,ident),
    audit(m,me,"seances","Fin de séance",session.title,{ état:"en cours" },{ état:"terminée", élèves_laissés_au_CDI:keep.length },true),
  ]);
  return { closed:leavers.meta.changes, ...await sessionDetail(m,ident,clock,fail) };
}
