-- Les répartitions de la fréquentation (affluence jour × heure, durées, types de venue, classes) survivent à la purge
-- des passages nominatifs : comme les totaux quotidiens, elles sont archivées en compteurs anonymes par jour.

CREATE TABLE archived_breakdown (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('hour','duration','source','class')),
  label TEXT NOT NULL,
  visits INTEGER NOT NULL,
  group_visits INTEGER NOT NULL DEFAULT 0,
  students INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,kind,label)
);

-- Passages conservés avec le jour et l’heure locaux (Europe/Paris) et la classe au moment du passage.
CREATE VIEW visit_facts AS
WITH visits_utc AS (
  SELECT v.*,starts_at / 1000 AS utc, date(starts_at / 1000,'unixepoch','start of year') AS yr FROM visits v
), shifted AS (
  SELECT *,utc + CASE
    WHEN utc >= unixepoch(yr,'+3 months','-1 day','-6 days','weekday 0','+1 hour')
     AND utc < unixepoch(yr,'+10 months','-1 day','-6 days','weekday 0','+1 hour')
    THEN 7200 ELSE 3600 END AS local
  FROM visits_utc
)
SELECT v.id,v.student_id,v.starts_at,v.expires_at,v.ended_at,v.source,
  date(v.local,'unixepoch') AS day,CAST(strftime('%H',v.local,'unixepoch') AS INTEGER) AS hour,
  coalesce(v.class_name,(SELECT c.name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=v.student_id)) AS class_label
FROM shifted v;

DROP TRIGGER privacy_apply;
CREATE TRIGGER privacy_apply AFTER INSERT ON privacy_tasks BEGIN
  DELETE FROM visits
    WHERE NEW.op='restore' AND starts_at<(SELECT archived_before FROM privacy_state)
      AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock;

  INSERT INTO daily_statistics(day,visits,group_visits,early_exits,observed_ms,distinct_floor)
  SELECT day,count(*),sum(source IN ('classe','groupe')),
    sum(ended_at IS NOT NULL AND ended_at<expires_at),
    sum(max(0,min(coalesce(ended_at,expires_at),expires_at,NEW.clock)-starts_at)),count(DISTINCT student_id)
  FROM dated_visits
  WHERE (NEW.op='erase' AND student_id=NEW.student_id)
    OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock
        AND student_id NOT IN (SELECT student_id FROM erased_students))
  GROUP BY day
  ON CONFLICT(day) DO UPDATE SET visits=visits+excluded.visits,group_visits=group_visits+excluded.group_visits,
    early_exits=early_exits+excluded.early_exits,observed_ms=observed_ms+excluded.observed_ms,distinct_floor=max(distinct_floor,excluded.distinct_floor);

  -- Répartitions anonymes conservées avec les totaux : heure d’arrivée, durée, type de venue et classe.
  INSERT INTO archived_breakdown(day,kind,label,visits,group_visits,students)
  SELECT day,'hour',printf('%02d',hour),count(*),sum(source IN ('classe','groupe')),count(DISTINCT student_id)
    FROM visit_facts WHERE (NEW.op='erase' AND student_id=NEW.student_id)
      OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock
          AND student_id NOT IN (SELECT student_id FROM erased_students))
    GROUP BY day,hour
  UNION ALL
  SELECT day,'duration',CASE WHEN d<15 THEN '0' WHEN d<30 THEN '1' WHEN d<60 THEN '2' WHEN d<120 THEN '3' ELSE '4' END AS bucket,
      count(*),sum(source IN ('classe','groupe')),count(DISTINCT student_id)
    FROM (SELECT day,source,student_id,max(0,min(coalesce(ended_at,expires_at),expires_at,NEW.clock)-starts_at)/60000.0 AS d
      FROM visit_facts WHERE (NEW.op='erase' AND student_id=NEW.student_id)
      OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock
          AND student_id NOT IN (SELECT student_id FROM erased_students)))
    GROUP BY day,bucket
  UNION ALL
  SELECT day,'source',source,count(*),sum(source IN ('classe','groupe')),count(DISTINCT student_id)
    FROM visit_facts WHERE (NEW.op='erase' AND student_id=NEW.student_id)
      OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock
          AND student_id NOT IN (SELECT student_id FROM erased_students))
    GROUP BY day,source
  UNION ALL
  SELECT day,'class',class_label,count(*),sum(source IN ('classe','groupe')),count(DISTINCT student_id)
    FROM visit_facts WHERE ((NEW.op='erase' AND student_id=NEW.student_id)
      OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock
          AND student_id NOT IN (SELECT student_id FROM erased_students))) AND class_label IS NOT NULL
    GROUP BY day,class_label
  ON CONFLICT(day,kind,label) DO UPDATE SET visits=visits+excluded.visits,group_visits=group_visits+excluded.group_visits,
    students=max(students,excluded.students);

  INSERT OR IGNORE INTO erased_students SELECT NEW.student_id WHERE NEW.op='erase';

  DELETE FROM visits WHERE (NEW.op IN ('erase','restore') AND student_id IN (SELECT student_id FROM erased_students))
    OR (NEW.op IN ('purge','restore') AND starts_at<NEW.cutoff AND min(coalesce(ended_at,expires_at),expires_at)<=NEW.clock);

  UPDATE visits SET attendance_id=NULL
    WHERE NEW.op IN ('purge','restore') AND attendance_id IN
      (SELECT id FROM attendance WHERE started_at<NEW.cutoff)
      AND NOT EXISTS (SELECT 1 FROM visits AS active WHERE active.attendance_id=visits.attendance_id
        AND active.ended_at IS NULL AND active.expires_at>NEW.clock);
  DELETE FROM attendance WHERE NEW.op IN ('purge','restore') AND started_at<NEW.cutoff
    AND NOT EXISTS(SELECT 1 FROM visits WHERE attendance_id=attendance.id);
  DELETE FROM attendance_members WHERE NEW.op IN ('erase','restore') AND student_id IN (SELECT student_id FROM erased_students);

  DELETE FROM school_year_members
    WHERE (NEW.op IN ('erase','restore') AND student_id IN (SELECT student_id FROM erased_students))
       OR (NEW.op IN ('purge','restore') AND year_label IN (SELECT label FROM school_year WHERE closed_at<NEW.cutoff));
  DELETE FROM exclusions
    WHERE (NEW.op IN ('erase','restore') AND student_id IN (SELECT student_id FROM erased_students))
       OR (NEW.op IN ('purge','restore') AND NEW.cutoff>0
          AND (revoked_at<NEW.cutoff OR until_day<date(NEW.cutoff/1000+7200,'unixepoch')));
  DELETE FROM group_members WHERE NEW.op IN ('erase','restore') AND student_id IN (SELECT student_id FROM erased_students);
  DELETE FROM students WHERE NEW.op IN ('erase','restore') AND id IN (SELECT student_id FROM erased_students);
  DELETE FROM audit_log WHERE NEW.op IN ('purge','restore') AND at<NEW.audit_cutoff;
  DELETE FROM encrypted_backups WHERE NEW.op IN ('purge','restore') AND created_at<NEW.backup_cutoff;
  DELETE FROM encrypted_backups WHERE NEW.op='erase';
  DELETE FROM kiosk_devices WHERE expires_at<=NEW.clock OR NEW.op='restore';
  UPDATE privacy_state SET last_success=NEW.clock, archived_before=max(archived_before,NEW.cutoff)
    WHERE id=1 AND NEW.op IN ('purge','restore');
  DELETE FROM privacy_tasks WHERE rowid=NEW.rowid;
END;
