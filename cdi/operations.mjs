import { seatsSql } from "./capacity.mjs";
import { parisMidnight, presenceDeadline, shiftDay, timeSegments } from "./calendar.mjs";

export function classRoster(m, classId) {
  return m.list(`SELECT id,first_name,last_name FROM students WHERE class_id=? AND active=1
    ORDER BY last_name,first_name,id`, classId);
}
export async function groupArrival(m, body, clock, day, fail) {
  const { class_id:classId, student_ids:selected, duration } = body;
  if (typeof classId!=="string" || !Array.isArray(selected) || selected.length<1 || selected.length>400
    || selected.some(item=>typeof item!=="string" || item.length>80) || ![60,120].includes(duration)) {
    fail(400,"Sélectionnez une classe, des élèves présents et une durée.");
  }
  const ids = [...new Set(selected)];
  const items = JSON.stringify(ids);
  const states = `SELECT s.id,c.name AS group_name, CASE
    WHEN s.id IS NULL THEN 'unavailable'
    WHEN EXISTS (SELECT 1 FROM exclusions x WHERE x.student_id=s.id AND x.revoked_at IS NULL AND x.until_day>=?) THEN 'excluded'
    WHEN EXISTS (SELECT 1 FROM visits v WHERE v.student_id=s.id AND v.ended_at IS NULL AND v.expires_at>?) THEN 'already'
    ELSE 'ready' END AS state
    FROM json_each(?) input LEFT JOIN students s ON s.id=input.value AND s.class_id=? AND s.active=1
    LEFT JOIN classes c ON c.id=s.class_id`;
  const [previous, added] = await m.batch([
    m.stmt(`SELECT state,count(*) AS total FROM (${states}) GROUP BY state`,day,clock,items,classId),
    m.stmt(`INSERT INTO visits (id,student_id,starts_at,expires_at,source,class_name)
      SELECT lower(hex(randomblob(16))),s.id,?,?,'classe',s.group_name FROM (${states}) s WHERE s.state='ready' LIMIT ${seatsSql}`,
      clock,presenceDeadline(clock,duration/60),day,clock,items,classId,clock),
  ]);
  const counts = Object.fromEntries(previous.results.map(({state,total})=>[state,total]));
  const full=(counts.ready??0)-added.meta.changes;
  return { added:added.meta.changes, ...(full?{full}:{}), already:counts.already??0, excluded:counts.excluded??0, unavailable:counts.unavailable??0 };
}

export async function statistics(m, from, to, now) {
  const start = parisMidnight(from);
  const end = parisMidnight(shiftDay(to,1));
  const spans = JSON.stringify(timeSegments(start,end));
  const results = await m.batch([
    m.stmt(`SELECT count(*) AS visits, count(DISTINCT student_id) AS students,
      coalesce(sum(CASE WHEN source IN ('classe','groupe') THEN 1 ELSE 0 END),0) AS group_visits,
      coalesce(sum(CASE WHEN ended_at IS NOT NULL AND ended_at<expires_at THEN 1 ELSE 0 END),0) AS early_exits,
      coalesce(avg(max(0,min(coalesce(ended_at,expires_at),expires_at,?)-starts_at))/60000.0,0) AS average
      FROM visits WHERE starts_at>=? AND starts_at<?`,now,start,end),
    m.stmt(`WITH local_times AS (
        SELECT (v.starts_at+(j.value->>'offset'))/1000 AS ts
        FROM visits v JOIN json_each(?) j ON v.starts_at>=j.value->>'start' AND v.starts_at<j.value->>'end'
        WHERE v.starts_at>=? AND v.starts_at<?)
      SELECT date(ts,'unixepoch') AS day,strftime('%H',ts,'unixepoch') AS hour,count(*) AS total
      FROM local_times GROUP BY day,hour ORDER BY day,hour`,spans,start,end),
    m.stmt(`SELECT coalesce(v.class_name,c.name) AS name,count(*) AS visits,count(DISTINCT v.student_id) AS students,
      sum(CASE WHEN v.source IN ('classe','groupe') THEN 1 ELSE 0 END) AS group_visits
      FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
      WHERE v.starts_at>=? AND v.starts_at<? GROUP BY coalesce(v.class_name,c.name) ORDER BY visits DESC,name`,start,end),
    m.stmt(`WITH overlap AS (
        SELECT max(starts_at,?) AS a,min(coalesce(ended_at,expires_at),expires_at,?) AS b
        FROM visits WHERE starts_at<? AND expires_at>? AND (ended_at IS NULL OR ended_at>?)),
      changes AS (SELECT a AS ts,1 AS delta FROM overlap WHERE a<b UNION ALL SELECT b,-1 FROM overlap WHERE a<b),
      timeline AS (SELECT sum(sum(delta)) OVER (ORDER BY ts) AS concurrent FROM changes GROUP BY ts)
      SELECT coalesce(max(concurrent),0) AS peak FROM timeline`,start,Math.min(end,now),Math.min(end,now),start,start),
  ]);
  const daily = {};
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  for (const {day,hour,total} of results[1].results) {
    daily[day] = (daily[day] ?? 0) + total;
    hours[Number(hour)] += total;
    weekdays[(new Date(day+"T12:00:00Z").getUTCDay() + 6) % 7] += total;
  }
  return {
    ...results[0].results[0], ...results[3].results[0], from, to, hours, weekdays,
    daily:Object.entries(daily).map(([day,visits])=>({day,visits})), classes:results[2].results,
  };
}
