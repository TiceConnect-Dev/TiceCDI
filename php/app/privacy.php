<?php
declare(strict_types=1);

const PROFILE_FIELDS = ['institution','contact','dpd','purpose','basis','source','recipients','hosting','rights'];
const MAX_ENVELOPE_BYTES = 19_000_000;
const DAY_MS = 86_400_000;

function privacySettings(Store $db): array
{
    $row = $db->one('SELECT * FROM privacy_settings WHERE id=1');
    $row['profile'] = json_decode($row['profile']);
    $row['public_planning'] = (bool) $row['public_planning'];
    $row['purge_enabled'] = (bool) $row['purge_enabled'];
    return $row;
}

function changePrivacy(Store $db, array $me, array $body): array
{
    $before = privacySettings($db);
    if (!is_array($body['profile'] ?? null) || !is_bool($body['public_planning'] ?? null) || !is_bool($body['purge_enabled'] ?? null)) {
        fail(400, 'Réglages incomplets.');
    }
    $bounds = ['retention_days' => [0,3650], 'audit_days' => [1,3650], 'backup_days' => [1,365], 'backup_limit' => [1,30]];
    $confirm = !$before['purge_enabled'] && $body['purge_enabled'];
    foreach ($bounds as $key => [$min,$max]) {
        $value = $body[$key] ?? null;
        if (!is_int($value) || $value < $min || $value > $max) {
            fail(400, 'Une durée ou une limite de conservation est invalide.');
        }
        $confirm = $confirm || $value < $before[$key];
    }
    if ($body['purge_enabled'] && $confirm && ($body['confirm_retention'] ?? false) !== true) {
        fail(409, 'Confirmez l’application des nouvelles durées aux données existantes.');
    }
    $profile = [];
    foreach (PROFILE_FIELDS as $key) {
        $value = $body['profile'][$key] ?? '';
        if (!is_string($value) || mb_strlen($value, 'UTF-8') > 1500) {
            fail(400, 'Chaque champ de la notice accepte au maximum 1 500 caractères.');
        }
        $profile[$key] = trim($value);
    }
    $db->run('UPDATE privacy_settings SET profile=?,public_planning=?,purge_enabled=?,retention_days=?,audit_days=?,backup_days=?,backup_limit=? WHERE id=1',
        jsonData($profile), $body['public_planning'], $body['purge_enabled'], $body['retention_days'],
        $body['audit_days'], $body['backup_days'], $body['backup_limit']);
    audit($db, $me, 'confidentialite', 'Modification des réglages de confidentialité', 'Établissement', null,
        ['purge' => $body['purge_enabled'], 'passages_jours' => $body['retention_days'], 'journaux_jours' => $body['audit_days']]);
    return privacySettings($db) + $db->one('SELECT last_success FROM privacy_state WHERE id=1');
}

function noticeData(Store $db): array
{
    $settings = privacySettings($db);
    unset($settings['id']);
    return $settings;
}

function task(Store $db, array $settings, int $clock, string $op = 'purge', ?string $student = null): void
{
    $cutoff = $settings['purge_enabled'] ? midnight(shiftDay(parisClock($clock)['day'], -$settings['retention_days']))->getTimestamp()*1000 : 0;
    $db->run('INSERT INTO privacy_tasks(op,clock,cutoff,audit_cutoff,backup_cutoff,student_id) VALUES(?,?,?,?,?,?)',
        $op, $clock, $cutoff, $settings['purge_enabled'] ? $clock-$settings['audit_days']*DAY_MS : 0,
        $settings['purge_enabled'] ? $clock-$settings['backup_days']*DAY_MS : 0, $student);
}

function rotateBackups(Store $db): void
{
    $db->run('DELETE FROM encrypted_backups WHERE id NOT IN (SELECT id FROM encrypted_backups ORDER BY created_at DESC,id DESC
        LIMIT (SELECT backup_limit FROM privacy_settings WHERE id=1))');
}

function maintain(Store $db, int $clock): array
{
    $settings = privacySettings($db);
    task($db, $settings, $clock);
    if ($settings['purge_enabled']) {
        rotateBackups($db);
    }
    return $db->one('SELECT last_success FROM privacy_state WHERE id=1');
}

// Statistiques détaillées, sans seuil de masquage (mêmes requêtes que cdi/privacy.mjs).
// Les totaux quotidiens incluent les jours archivés ; les répartitions fines portent sur les passages conservés.
function privateStatistics(Store $db, string $from, string $to, int $clock): array
{
    if (!validDay($from) || !validDay($to) || $from > $to || $to > parisClock($clock)['day']
        || midnight($from)->diff(midnight($to))->days >= 366) {
        fail(400, 'Choisissez une période de 366 jours maximum qui se termine aujourd’hui ou plus tôt.');
    }
    $length = midnight($from)->diff(midnight($to))->days + 1;
    $prevTo = shiftDay($from, -1);
    $prevFrom = shiftDay($from, -$length);
    $start = midnight($from)->getTimestamp() * 1000;
    $end = min(midnight(shiftDay($to, 1))->getTimestamp() * 1000, $clock);
    $daily = $db->all("WITH all_days AS (
        SELECT day,visits,group_visits,early_exits,observed_ms,distinct_floor FROM daily_statistics WHERE day BETWEEN ? AND ?
        UNION ALL
        SELECT day,count(*),sum(source IN ('classe','groupe')),sum(ended_at IS NOT NULL AND ended_at<expires_at),
          sum(max(0,min(coalesce(ended_at,expires_at),expires_at,?)-starts_at)),count(DISTINCT student_id)
        FROM dated_visits WHERE day BETWEEN ? AND ? GROUP BY day
        ) SELECT day,sum(visits) AS visits,sum(group_visits) AS group_visits,sum(early_exits) AS early_exits,sum(observed_ms) AS observed_ms,max(distinct_floor) AS students
          FROM all_days GROUP BY day ORDER BY day", $from, $to, $clock, $from, $to);
    $hours = $db->all("SELECT CAST(strftime('%w',local,'unixepoch') AS INTEGER) AS weekday,CAST(strftime('%H',local,'unixepoch') AS INTEGER) AS hour,count(*) AS visits
        FROM local_visits WHERE date(local,'unixepoch') BETWEEN ? AND ? GROUP BY weekday,hour ORDER BY weekday,hour", $from, $to);
    $retained = $db->one('SELECT count(*) AS visits,count(DISTINCT student_id) AS students,min(day) AS first_day FROM dated_visits WHERE day BETWEEN ? AND ?', $from, $to);
    $sources = $db->all('SELECT source,count(*) AS visits FROM dated_visits WHERE day BETWEEN ? AND ? GROUP BY source ORDER BY visits DESC', $from, $to);
    $classes = $db->all("SELECT coalesce(v.class_name,c.name) AS name,count(*) AS visits,count(DISTINCT v.student_id) AS students,
          sum(v.source IN ('classe','groupe')) AS group_visits,
          (SELECT count(*) FROM students s2 JOIN classes c2 ON c2.id=s2.class_id WHERE c2.name=coalesce(v.class_name,c.name) AND s2.active=1) AS size
        FROM dated_visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.day BETWEEN ? AND ? GROUP BY coalesce(v.class_name,c.name) ORDER BY visits DESC,name", $from, $to);
    $durations = $db->all('SELECT CASE WHEN d<15 THEN 0 WHEN d<30 THEN 1 WHEN d<60 THEN 2 WHEN d<120 THEN 3 ELSE 4 END AS bucket,count(*) AS visits
        FROM (SELECT max(0,min(coalesce(ended_at,expires_at),expires_at,?)-starts_at)/60000.0 AS d FROM dated_visits WHERE day BETWEEN ? AND ?) GROUP BY bucket', $clock, $from, $to);
    $frequency = $db->all('SELECT CASE WHEN n=1 THEN 0 WHEN n<=3 THEN 1 WHEN n<=9 THEN 2 ELSE 3 END AS bucket,count(*) AS students
        FROM (SELECT count(*) AS n FROM dated_visits WHERE day BETWEEN ? AND ? GROUP BY student_id) GROUP BY bucket', $from, $to);
    $previous = $db->one('SELECT (SELECT coalesce(sum(visits),0) FROM daily_statistics WHERE day BETWEEN ? AND ?)+(SELECT count(*) FROM dated_visits WHERE day BETWEEN ? AND ?) AS visits',
        $prevFrom, $prevTo, $prevFrom, $prevTo);
    $peak = $db->one('WITH overlap AS (
          SELECT max(starts_at,?) AS a,min(coalesce(ended_at,expires_at),expires_at,?) AS b
          FROM visits WHERE starts_at<? AND expires_at>? AND (ended_at IS NULL OR ended_at>?)),
        changes AS (SELECT a AS ts,1 AS delta FROM overlap WHERE a<b UNION ALL SELECT b,-1 FROM overlap WHERE a<b),
        timeline AS (SELECT sum(sum(delta)) OVER (ORDER BY ts) AS concurrent FROM changes GROUP BY ts)
        SELECT coalesce(max(concurrent),0) AS peak FROM timeline', $start, $end, $end, $start, $start);

    $int = static fn ($value) => (int) ($value ?? 0);
    $visits = array_sum(array_map($int, array_column($daily, 'visits')));
    $observed = array_sum(array_map($int, array_column($daily, 'observed_ms')));
    $busiest = null;
    foreach ($daily as $row) {
        if ($busiest === null || (int) $row['visits'] > $busiest['visits']) {
            $busiest = ['day' => $row['day'], 'visits' => (int) $row['visits']];
        }
    }
    $bucket = static function (array $rows, array $names, string $key): array {
        $out = [];
        foreach ($names as $index => $label) {
            $count = 0;
            foreach ($rows as $row) {
                if ((int) $row['bucket'] === $index) {
                    $count = (int) $row[$key];
                }
            }
            $out[] = ['label' => $label, 'count' => $count];
        }
        return $out;
    };
    return [
        'from' => $from, 'to' => $to, 'hidden' => false, 'visits' => $visits,
        'average' => $visits ? $observed / $visits / 60000 : 0, 'observed_hours' => $observed / 3_600_000,
        'group_visits' => array_sum(array_map($int, array_column($daily, 'group_visits'))),
        'early_exits' => array_sum(array_map($int, array_column($daily, 'early_exits'))),
        'days' => count($daily), 'per_day' => $daily ? $visits / count($daily) : 0, 'busiest' => $busiest,
        'peak' => (int) $peak['peak'], 'previous' => ['from' => $prevFrom, 'to' => $prevTo, 'visits' => (int) $previous['visits']],
        'students' => (int) $retained['students'], 'retained_visits' => (int) $retained['visits'], 'retained_from' => $retained['first_day'],
        'daily' => array_map(static fn ($row) => ['day' => $row['day'], 'visits' => (int) $row['visits'], 'group_visits' => (int) $row['group_visits'],
            'early_exits' => (int) $row['early_exits'], 'students' => (int) $row['students']], $daily),
        'hours' => array_map(static fn ($row) => ['weekday' => (int) $row['weekday'] === 0 ? 7 : (int) $row['weekday'], 'hour' => (int) $row['hour'],
            'visits' => (int) $row['visits']], $hours),
        'sources' => array_map(static fn ($row) => ['source' => $row['source'], 'visits' => (int) $row['visits']], $sources),
        'classes' => array_map(static fn ($row) => ['name' => $row['name'], 'visits' => (int) $row['visits'], 'students' => (int) $row['students'],
            'group_visits' => (int) $row['group_visits'], 'size' => (int) $row['size']], $classes),
        'durations' => $bucket($durations, ['Moins de 15 min', '15 à 30 min', '30 min à 1 h', '1 à 2 h', 'Plus de 2 h'], 'visits'),
        'frequency' => $bucket($frequency, ['1 passage', '2 à 3 passages', '4 à 9 passages', '10 passages et plus'], 'students'),
    ];
}

function studentFile(Store $db, string $id): array
{
    $student = $db->one('SELECT s.id,s.first_name,s.last_name,s.external_id,s.code,s.active,s.class_id,c.name AS class_name
        FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?', $id);
    if (!$student) {
        fail(404, 'Élève introuvable.');
    }
    $visits = $db->all("SELECT starts_at,expires_at,ended_at,source,class_name,CASE WHEN ended_at IS NOT NULL THEN 'sortie_enregistree'
        WHEN expires_at<=? THEN 'creneau_expire' ELSE 'en_cours' END AS status FROM visits WHERE student_id=? ORDER BY starts_at DESC", clockMs(),$id);
    $attendance = $db->all('SELECT a.started_at,a.ended_at,am.status,am.class_name FROM attendance_members am
        JOIN attendance a ON a.id=am.attendance_id WHERE am.student_id=? ORDER BY a.started_at DESC', $id);
    $exclusions = $db->all('SELECT reason,until_day,created_at,revoked_at FROM exclusions WHERE student_id=? ORDER BY created_at DESC', $id);
    $archives = $db->all('SELECT year_label,first_name,last_name,class_name FROM school_year_members WHERE student_id=? ORDER BY year_label DESC', $id);
    return compact('student','visits','attendance','exclusions','archives');
}

function checkedPrivacyState(mixed $raw): array
{
    if ($raw === null) {
        return ['archived_before' => 0, 'daily' => [], 'erased' => []];
    }
    if (!is_array($raw) || !is_int($raw['archived_before'] ?? null) || $raw['archived_before'] < 0
        || $raw['archived_before'] > clockMs()+DAY_MS || !is_array($raw['daily'] ?? null) || !is_array($raw['erased'] ?? null)) {
        fail(400, 'L’état des purges de la sauvegarde est invalide.');
    }
    foreach ($raw['erased'] as $id) {
        if (!is_string($id) || !preg_match('/^[a-f0-9-]{16,64}$/D', $id)) {
            fail(400, 'L’état des purges de la sauvegarde est invalide.');
        }
    }
    foreach ($raw['daily'] as $row) {
        if (!is_array($row) || !validDay($row['day'] ?? null)) {
            fail(400, 'L’état des purges de la sauvegarde est invalide.');
        }
        foreach (['visits','group_visits','early_exits','observed_ms','distinct_floor'] as $key) {
            if (!is_int($row[$key] ?? null) || $row[$key] < 0) {
                fail(400, 'L’état des purges de la sauvegarde est invalide.');
            }
        }
    }
    return $raw;
}

function recoveryState(Store $db): array
{
    return ['archived_before' => $db->one('SELECT archived_before FROM privacy_state WHERE id=1')['archived_before'],
        'daily' => $db->all('SELECT * FROM daily_statistics ORDER BY day'),
        'erased' => array_column($db->all('SELECT student_id FROM erased_students ORDER BY student_id'),'student_id')];
}

function applyRecovery(Store $db, array $privacy, int $clock): void
{
    $db->run('INSERT OR IGNORE INTO erased_students SELECT value FROM json_each(?)', jsonData($privacy['erased']));
    $db->run("INSERT OR IGNORE INTO daily_statistics(day,visits,group_visits,early_exits,observed_ms,distinct_floor)
        SELECT value->>'day',value->>'visits',value->>'group_visits',value->>'early_exits',value->>'observed_ms',value->>'distinct_floor' FROM json_each(?)",
        jsonData($privacy['daily']));
    $db->run('UPDATE privacy_state SET archived_before=max(archived_before,?) WHERE id=1', $privacy['archived_before']);
    task($db, privacySettings($db), $clock, 'restore');
}

function backupPhrase(mixed $value): string
{
    if (!is_string($value) || strlen($value) < 12 || strlen($value) > 512) {
        fail(400, 'Utilisez une phrase secrète de 12 caractères au minimum.');
    }
    return $value;
}

function encryptBackup(string $data, mixed $secret): array
{
    $salt = random_bytes(16);
    $iv = random_bytes(12);
    $key = hash_pbkdf2('sha256', backupPhrase($secret), $salt, 310000, 32, true);
    $encrypted = openssl_encrypt($data, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($encrypted === false) {
        throw new RuntimeException('Chiffrement indisponible');
    }
    return ['format' => 'cdi-encrypted', 'version' => 1, 'salt' => base64_encode($salt),
        'iv' => base64_encode($iv), 'data' => base64_encode($encrypted . $tag)];
}

function decryptBackup(mixed $envelope, mixed $secret): array
{
    if (is_array($envelope) && ($envelope['format'] ?? null) === 'cdi-backup' && ($envelope['version'] ?? null) === 1) {
        return $envelope;
    }
    if (!is_array($envelope) || ($envelope['format'] ?? null) !== 'cdi-encrypted' || ($envelope['version'] ?? null) !== 1
        || !is_string($envelope['salt'] ?? null) || !is_string($envelope['iv'] ?? null) || !is_string($envelope['data'] ?? null)) {
        fail(400, 'Format de sauvegarde inconnu.');
    }
    $phrase = backupPhrase($secret);
    $salt = base64_decode($envelope['salt'], true);
    $iv = base64_decode($envelope['iv'], true);
    $data = base64_decode($envelope['data'], true);
    if ($salt === false || $iv === false || $data === false || strlen($salt) !== 16 || strlen($iv) !== 12 || strlen($data) < 17) {
        fail(400, 'Sauvegarde endommagée.');
    }
    $key = hash_pbkdf2('sha256', $phrase, $salt, 310000, 32, true);
    $plain = openssl_decrypt(substr($data, 0, -16), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, substr($data, -16));
    $decoded = $plain === false ? null : json_decode($plain, true);
    if (!is_array($decoded)) {
        fail(400, 'Phrase secrète incorrecte ou sauvegarde endommagée.');
    }
    return $decoded;
}
