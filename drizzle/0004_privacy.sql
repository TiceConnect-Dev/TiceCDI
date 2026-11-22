CREATE TABLE privacy_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  profile TEXT NOT NULL DEFAULT '{}',
  public_planning INTEGER NOT NULL DEFAULT 0 CHECK(public_planning IN (0,1)),
  purge_enabled INTEGER NOT NULL DEFAULT 1 CHECK(purge_enabled IN (0,1)),
  retention_days INTEGER NOT NULL DEFAULT 0 CHECK(retention_days BETWEEN 0 AND 3650),
  audit_days INTEGER NOT NULL DEFAULT 90 CHECK(audit_days BETWEEN 1 AND 3650),
  backup_days INTEGER NOT NULL DEFAULT 30 CHECK(backup_days BETWEEN 1 AND 365),
  backup_limit INTEGER NOT NULL DEFAULT 5 CHECK(backup_limit BETWEEN 1 AND 30)
);
-- Une base reprise reste en attente de validation de la purge.
INSERT INTO privacy_settings(id,purge_enabled) SELECT 1, NOT (
  EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM visits) OR EXISTS(SELECT 1 FROM students)
);

CREATE TABLE privacy_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_success INTEGER,
  archived_before INTEGER NOT NULL DEFAULT 0
);
INSERT INTO privacy_state (id) VALUES (1);

CREATE TABLE kiosk_devices (
  token TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX kiosk_devices_expiry ON kiosk_devices(expires_at);

CREATE TABLE erased_students (
  student_id TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE daily_statistics (
  day TEXT PRIMARY KEY NOT NULL,
  visits INTEGER NOT NULL,
  group_visits INTEGER NOT NULL,
  early_exits INTEGER NOT NULL,
  observed_ms INTEGER NOT NULL,
  distinct_floor INTEGER NOT NULL
);

CREATE TABLE encrypted_backups (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  envelope TEXT NOT NULL
);
CREATE INDEX encrypted_backups_time ON encrypted_backups(created_at DESC,id DESC);

CREATE VIEW dated_visits AS
WITH visits_utc AS (
  SELECT v.*,starts_at / 1000 AS utc, date(starts_at / 1000,'unixepoch','start of year') AS yr FROM visits v
)
SELECT v.*, date(utc + CASE
  WHEN utc >= unixepoch(yr,'+3 months','-1 day','-6 days','weekday 0','+1 hour')
   AND utc < unixepoch(yr,'+10 months','-1 day','-6 days','weekday 0','+1 hour')
   THEN 7200 ELSE 3600 END,'unixepoch') AS day
FROM visits_utc v;

CREATE TABLE privacy_tasks (
  op TEXT NOT NULL CHECK(op IN ('purge','erase','restore')),
  clock INTEGER NOT NULL,
  cutoff INTEGER NOT NULL DEFAULT 0,
  audit_cutoff INTEGER NOT NULL DEFAULT 0,
  backup_cutoff INTEGER NOT NULL DEFAULT 0,
  student_id TEXT
);

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

-- Écarter les noms qui étaient recopiés dans les anciennes opérations de présence et d’appel.
UPDATE audit_log SET target='Présence',before_json=NULL,after_json=NULL WHERE area='presences';
UPDATE audit_log SET target='Fiche d’appel',before_json=NULL,after_json=NULL
  WHERE area='seances' AND action='Correction d’un appel';
