<?php
declare(strict_types=1);

function kioskSettings(Store $db): array
{
    $row = $db->one('SELECT * FROM kiosk_settings WHERE id=1');
    return ['open' => ($row['is_open'] ?? 1) !== 0, 'second_hour' => ($row['allow_second_hour'] ?? 1) !== 0,
        'message' => $row['message'] ?? '', 'capacity' => $row['capacity'] ?? null,
        'hide_weekend' => ($row['hide_weekend'] ?? 0) === 1];
}

function changeKioskSettings(Store $db, array $me, array $data): array
{
    if (!is_bool($data['open'] ?? null) || !is_bool($data['second_hour'] ?? null) || !is_string($data['message'] ?? null)) {
        fail(400, 'Les réglages de la borne sont incomplets.');
    }
    $before = kioskSettings($db);
    $capacity = array_key_exists('capacity', $data) ? $data['capacity'] : $before['capacity'];
    $hide = $data['hide_weekend'] ?? $before['hide_weekend'];
    if (($capacity !== null && (!is_int($capacity) || $capacity < 1 || $capacity > 1000)) || !is_bool($hide)) {
        fail(400, 'Indiquez une capacité comprise entre 1 et 1 000 places ou laissez le champ vide.');
    }
    $message = clean($data['message']);
    if (mb_strlen($message, 'UTF-8') > 180) {
        fail(400, 'Le message peut contenir jusqu’à 180 caractères.');
    }
    $db->run('INSERT INTO kiosk_settings (id,is_open,allow_second_hour,message,capacity,hide_weekend) VALUES (1,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET is_open=excluded.is_open,allow_second_hour=excluded.allow_second_hour,
        message=excluded.message,capacity=excluded.capacity,hide_weekend=excluded.hide_weekend',
        $data['open'], $data['second_hour'], $message, $capacity, $hide);
    $after = kioskSettings($db);
    audit($db, $me, 'horaires', 'Modification des réglages', 'Borne et planning', $before, $after);
    return $after;
}

function openingHours(Store $db): array
{
    $row = $db->one('SELECT use_hours,hide_weekend FROM kiosk_settings WHERE id=1');
    return ['use_hours' => ($row['use_hours'] ?? 0) === 1, 'hide_weekend' => ($row['hide_weekend'] ?? 0) === 1,
        'hours' => $db->all('SELECT weekday,start_min,end_min FROM opening_hours ORDER BY weekday,start_min')];
}

function normalizeHours(mixed $raw): array
{
    if (!is_array($raw) || !array_is_list($raw) || count($raw) > 28) {
        fail(400, 'Saisissez au maximum quatre plages par jour.');
    }
    $rows = [];
    foreach ($raw as $row) {
        $day = $row['weekday'] ?? null;
        $start = $row['start_min'] ?? null;
        $end = $row['end_min'] ?? null;
        if (!is_int($day) || $day < 1 || $day > 7 || !is_int($start) || !is_int($end)
            || $start < 0 || $end > 1440 || $start >= $end) {
            fail(400, 'Chaque fermeture doit avoir lieu après l’ouverture.');
        }
        $rows[] = ['weekday' => $day, 'start_min' => $start, 'end_min' => $end];
    }
    usort($rows, static fn ($a, $b) => [$a['weekday'], $a['start_min']] <=> [$b['weekday'], $b['start_min']]);
    $last = $count = array_fill(1, 7, 0);
    foreach ($rows as $row) {
        $day = $row['weekday'];
        if (++$count[$day] > 4 || $row['start_min'] < $last[$day]) {
            fail(400, 'Les plages doivent être distinctes et sans chevauchement.');
        }
        $last[$day] = $row['end_min'];
    }
    return $rows;
}

function changeOpeningHours(Store $db, array $me, array $body): array
{
    $enabled = $body['use_hours'] ?? null;
    if (!is_bool($enabled)) {
        fail(400, 'Sélectionnez l’état des horaires automatiques.');
    }
    $rows = normalizeHours($body['hours'] ?? null);
    $before = openingHours($db);
    $db->run('INSERT INTO kiosk_settings (id,use_hours) VALUES (1,?)
        ON CONFLICT(id) DO UPDATE SET use_hours=excluded.use_hours', $enabled);
    $db->run('DELETE FROM opening_hours');
    foreach ($rows as $row) {
        $db->run('INSERT INTO opening_hours VALUES (?,?,?)', $row['weekday'], $row['start_min'], $row['end_min']);
    }
    $after = ['use_hours' => $enabled, 'hours' => $rows];
    audit($db, $me, 'horaires', 'Modification des horaires', 'Horaires d’ouverture', $before, $after);
    return $after;
}

function closure(Store $db, int $clock, array $settings): string
{
    if (!$settings['open']) {
        return 'Les inscriptions au CDI sont fermées pour le moment.';
    }
    $now = parisClock($clock);
    if ($db->one("SELECT id FROM planning WHERE day=? AND kind='fermeture' AND start_min<=? AND end_min>?",
        $now['day'], $now['minute'], $now['minute'])) {
        return 'Le CDI est fermé exceptionnellement sur ce créneau.';
    }
    if (($db->one('SELECT use_hours FROM kiosk_settings WHERE id=1')['use_hours'] ?? 0) === 1 &&
        !$db->one('SELECT 1 FROM opening_hours WHERE weekday=? AND start_min<=? AND end_min>?',
            $now['weekday'], $now['minute'], $now['minute'])) {
        return 'Le CDI est fermé selon les horaires d’ouverture.';
    }
    return '';
}

function validateMonday(mixed $day): string
{
    if (!validDay($day) || weekday($day) !== 1) {
        fail(400, 'Sélectionnez un lundi.');
    }
    return $day;
}

function weekPlanning(Store $db, string $start, int $clock, bool $internal = false): array
{
    $private = $internal ? ',p.class_id,p.group_id,p.notes,(SELECT id FROM attendance WHERE plan_id=p.id) AS attendance_id' : '';
    $rows = $db->all("SELECT p.id,p.day,p.start_min,p.end_min,p.title,p.kind,coalesce(c.name,g.name) AS class_name $private
        FROM planning p LEFT JOIN classes c ON c.id=p.class_id LEFT JOIN school_groups g ON g.id=p.group_id
        WHERE p.day>=? AND p.day<? ORDER BY p.day,p.start_min", $start, shiftDay($start, 7));
    return openingHours($db) + ['rows' => $rows, 'start' => $start, 'end' => shiftDay($start, 6), 'now' => parisClock($clock)];
}

function changeSlot(Store $db, array $me, ?string $id, array $data): array
{
    $day = $data['day'] ?? null;
    $start = $data['start_min'] ?? null;
    $end = $data['end_min'] ?? null;
    if (!validDay($day) || !is_int($start) || !is_int($end) || $start < 0 || $end > 1440 || $end - $start < 5) {
        fail(400, 'Indiquez une date et une plage d’au moins cinq minutes.');
    }
    $kind = $data['kind'] ?? null;
    if (!in_array($kind, SCHEDULE_KINDS, true)) {
        fail(400, 'Sélectionnez un type de créneau.');
    }
    $title = label($data['title'] ?? null, 'Le titre', 80);
    $class = clean($data['class_id'] ?? null) ?: null;
    $group = clean($data['group_id'] ?? null) ?: null;
    $notes = is_string($data['notes'] ?? null) ? trim($data['notes']) : '';
    if ($class !== null && $group !== null) {
        fail(400, 'Choisissez soit une classe, soit un groupe.');
    }
    if (mb_strlen($notes, 'UTF-8') > 600) {
        fail(400, 'Les notes peuvent contenir jusqu’à 600 caractères.');
    }
    $before = $id === null ? null : $db->one('SELECT day,start_min,end_min,title,kind,class_id,group_id,notes FROM planning WHERE id=?', $id);
    if ($id !== null && !$before) {
        fail(404, 'Créneau introuvable.');
    }
    if ($class !== null && !$db->one('SELECT id FROM classes WHERE id=?', $class)) {
        fail(400, 'La classe sélectionnée est introuvable.');
    }
    if ($group !== null && $group !== ($before['group_id'] ?? null) &&
        !$db->one('SELECT id FROM school_groups WHERE id=? AND active=1', $group)) {
        fail(400, 'Le groupe sélectionné est indisponible.');
    }
    if ($db->one('SELECT id FROM planning WHERE day=? AND start_min<? AND end_min>? AND id<>?', $day, $end, $start, $id ?? '')) {
        fail(409, 'Un créneau occupe déjà tout ou partie de cette plage.');
    }
    $after = ['day' => $day, 'start_min' => $start, 'end_min' => $end, 'title' => $title, 'kind' => $kind,
        'class_id' => $class, 'group_id' => $group, 'notes' => $notes];
    if ($id === null) {
        $db->run('INSERT INTO planning (id,day,start_min,end_min,title,kind,class_id,group_id,notes) VALUES (?,?,?,?,?,?,?,?,?)',
            uid(), ...array_values($after));
    } else {
        $db->run('UPDATE planning SET day=?,start_min=?,end_min=?,title=?,kind=?,class_id=?,group_id=?,notes=? WHERE id=?',
            ...[...array_values($after), $id]);
    }
    audit($db, $me, 'planning', $id === null ? 'Création du créneau' : 'Modification du créneau', $title, $before, $after);
    return ['ok' => true];
}

function duplicateWeek(Store $db, array $me, string $start): array
{
    if (!validDay(shiftDay($start, 13))) {
        fail(400, 'Sélectionnez une semaine valide.');
    }
    $end = shiftDay($start, 7);
    $count = $db->one('SELECT count(*) AS total FROM planning WHERE day>=? AND day<?', $start, $end)['total'];
    $added = $db->run("INSERT INTO planning (id,day,start_min,end_min,title,kind,class_id,notes,group_id)
        SELECT lower(hex(randomblob(16))),date(p.day,'+7 days'),p.start_min,p.end_min,p.title,p.kind,p.class_id,p.notes,p.group_id
        FROM planning p WHERE p.day>=? AND p.day<? AND NOT EXISTS (SELECT 1 FROM planning q
          WHERE q.day=date(p.day,'+7 days') AND q.start_min<p.end_min AND q.end_min>p.start_min)", $start, $end);
    if ($added > 0) {
        audit($db, $me, 'planning', 'Copie de la semaine', $start, null, ['semaine' => $end]);
    }
    return ['added' => $added, 'skipped' => $count - $added];
}

function statistics(Store $db, string $from, string $to, int $clock): array
{
    if (!validDay($from) || !validDay($to) || $from > $to || $to > parisClock($clock)['day']
        || midnight($from)->diff(midnight($to))->days >= 366) {
        fail(400, 'Choisissez une période de 366 jours maximum qui se termine aujourd’hui ou plus tôt.');
    }
    $start = midnight($from)->getTimestamp();
    $end = midnight(shiftDay($to, 1))->getTimestamp();
    $transitions = (new DateTimeZone('Europe/Paris'))->getTransitions($start, $end);
    $spans = [];
    foreach ($transitions as $i => $point) {
        $spans[] = ['start' => $point['ts'] * 1000, 'end' => ($transitions[$i + 1]['ts'] ?? $end) * 1000,
            'offset' => $point['offset'] * 1000];
    }
    $start *= 1000;
    $end *= 1000;
    $totals = $db->one("SELECT count(*) AS visits, count(DISTINCT student_id) AS students,
        coalesce(sum(CASE WHEN source IN ('classe','groupe') THEN 1 ELSE 0 END),0) AS group_visits,
        coalesce(sum(CASE WHEN ended_at IS NOT NULL AND ended_at<expires_at THEN 1 ELSE 0 END),0) AS early_exits,
        coalesce(avg(max(0,min(coalesce(ended_at,expires_at),expires_at,?)-starts_at))/60000.0,0) AS average
        FROM visits WHERE starts_at>=? AND starts_at<?", $clock, $start, $end);
    $rates = $db->all("WITH local_times AS (
        SELECT (v.starts_at+(j.value->>'offset'))/1000 AS ts FROM visits v JOIN json_each(?) j
          ON v.starts_at>=j.value->>'start' AND v.starts_at<j.value->>'end'
        WHERE v.starts_at>=? AND v.starts_at<?)
        SELECT date(ts,'unixepoch') AS day,strftime('%H',ts,'unixepoch') AS hour,count(*) AS total
        FROM local_times GROUP BY day,hour ORDER BY day,hour", jsonData($spans), $start, $end);
    $classes = $db->all("SELECT coalesce(v.class_name,c.name) AS name,count(*) AS visits,count(DISTINCT v.student_id) AS students,
        sum(CASE WHEN v.source IN ('classe','groupe') THEN 1 ELSE 0 END) AS group_visits
        FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
        WHERE v.starts_at>=? AND v.starts_at<? GROUP BY coalesce(v.class_name,c.name) ORDER BY visits DESC,name", $start, $end);
    $cap = min($end, $clock);
    $peak = $db->one('WITH overlap AS (
        SELECT max(starts_at,?) AS a,min(coalesce(ended_at,expires_at),expires_at,?) AS b
        FROM visits WHERE starts_at<? AND expires_at>? AND (ended_at IS NULL OR ended_at>?)),
        changes AS (SELECT a AS ts,1 AS delta FROM overlap WHERE a<b UNION ALL SELECT b,-1 FROM overlap WHERE a<b),
        timeline AS (SELECT sum(sum(delta)) OVER (ORDER BY ts) AS concurrent FROM changes GROUP BY ts)
        SELECT coalesce(max(concurrent),0) AS peak FROM timeline', $start, $cap, $cap, $start, $start)['peak'];
    $daily = [];
    $hours = array_fill(0, 24, 0);
    $weekdays = array_fill(0, 7, 0);
    foreach ($rates as $row) {
        $day = $row['day'];
        $daily[$day] = ($daily[$day] ?? 0) + $row['total'];
        $hours[(int) $row['hour']] += $row['total'];
        $weekdays[weekday($day) - 1] += $row['total'];
    }
    $daily = array_map(static fn ($day, $visits) => compact('day', 'visits'), array_keys($daily), array_values($daily));
    return $totals + compact('from', 'to', 'peak', 'daily', 'hours', 'weekdays', 'classes');
}
