<?php
declare(strict_types=1);

function occupancy(Store $db, int $clock): array
{
    $state = $db->one('SELECT (SELECT capacity FROM kiosk_settings WHERE id=1) AS capacity,
        (SELECT count(*) FROM visits WHERE ended_at IS NULL AND expires_at>?) AS occupied', $clock);
    return $state + ['places' => $state['capacity'] === null ? null : max(0, $state['capacity'] - $state['occupied'])];
}

/** Notifications du personnel : élève exclu à la borne, CDI presque plein (90 %) ou complet. Conservées 48 heures. */
function kioskEvent(Store $db, string $kind, string $message, int $clock, int $quiet = 0): void
{
    if ($quiet > 0 && $db->one('SELECT 1 AS yes FROM kiosk_events WHERE kind=? AND at>?', $kind, $clock - $quiet)) {
        return;
    }
    $db->run('DELETE FROM kiosk_events WHERE at<?', $clock - 48 * 3_600_000);
    $db->run('INSERT INTO kiosk_events (at,kind,message) VALUES (?,?,?)', $clock, $kind, $message);
}

/** Événement à enregistrer après l’annulation de la transaction (entrée refusée). */
function queueKioskEvent(string $kind, string $message, int $quiet = 0): void
{
    $GLOBALS['cdi_kiosk_events'][] = [$kind, $message, $quiet];
}

function flushKioskEvents(Store $db, int $clock): void
{
    foreach ($GLOBALS['cdi_kiosk_events'] ?? [] as [$kind, $message, $quiet]) {
        kioskEvent($db, $kind, $message, $clock, $quiet);
    }
    $GLOBALS['cdi_kiosk_events'] = [];
}

function capacityAlert(Store $db, int $clock): void
{
    $state = occupancy($db, $clock);
    if (!$state['capacity'] || $state['occupied'] / $state['capacity'] < 0.9) {
        return;
    }
    $full = $state['places'] === 0;
    kioskEvent($db, $full ? 'complet' : 'presque_plein', sprintf($full ? 'Le CDI est complet : %d élèves pour %d places.' : 'Le CDI est presque plein : %d élèves pour %d places.',
        $state['occupied'], $state['capacity']), $clock, 30 * 60_000);
}

function recentEvents(Store $db, int $clock, int $after = 0): array
{
    return $db->all('SELECT id,at,kind,message FROM kiosk_events WHERE at>? AND id>? ORDER BY id DESC LIMIT 50', $clock - 24 * 3_600_000, $after);
}

/** Motif de présence : texte court facultatif (60 caractères au plus). */
function visitReason(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value)) {
        fail(400, 'Indiquez un motif valide.');
    }
    $reason = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    if (mb_strlen($reason, 'UTF-8') > 60) {
        fail(400, 'Le motif peut contenir jusqu’à 60 caractères.');
    }
    return $reason === '' ? null : $reason;
}

function deniedStudent(Store $db, string $student, string $day): bool
{
    return (bool) $db->one('SELECT id FROM exclusions WHERE student_id=? AND revoked_at IS NULL AND until_day>=?', $student, $day);
}

function activePresence(Store $db, string $student, int $clock): ?array
{
    return $db->one('SELECT * FROM visits v WHERE student_id=? AND ' . ACTIVE_VISIT . ' ORDER BY expires_at DESC LIMIT 1', $student, $clock);
}

function addPresence(Store $db, string $student, int $clock, int $expires, string $source, string $class, ?string $attendance = null): void
{
    $db->run('INSERT INTO visits (id,student_id,starts_at,expires_at,source,class_name,attendance_id) VALUES (?,?,?,?,?,?,?)',
        uid(), $student, $clock, $expires, $source, $class, $attendance);
}

function kioskCheckIn(Store $db, array $data, int $clock): array
{
    $settings = kioskSettings($db);
    $reason = closure($db, $clock, $settings);
    if ($reason !== '') {
        fail(409, $reason);
    }
    $code = strtoupper(clean($data['code'] ?? null));
    if (!preg_match('/^CDI[0-9A-F]{10}$/D', $code)) {
        fail(400, 'Scanne ou saisis le code de ta carte CDI.');
    }
    $person = $db->one('SELECT s.id,s.first_name,s.last_name,c.name AS class_name ' . PEOPLE_JOIN . ' WHERE s.active=1 AND s.code=?', $code);
    if (!$person) {
        fail(404, 'Carte introuvable. Vérifie le code ou adresse-toi au personnel.');
    }
    $id = $person['id'];
    if (deniedStudent($db, $id, parisClock($clock)['day'])) {
        queueKioskEvent('exclu', $person['first_name'] . ' ' . $person['last_name'] . ' (' . $person['class_name'] . ') a tenté d’entrer à la borne alors qu’une exclusion du CDI est en cours.');
        fail(403, 'L’entrée n’a pas pu être enregistrée. Adresse-toi à l’accueil du CDI.');
    }
    $existing = activePresence($db, $id, $clock);
    if ($existing) {
        return ['expires_at' => $existing['expires_at'], 'already' => true];
    }
    if (occupancy($db, $clock)['places'] === 0) {
        queueKioskEvent('complet', 'Le CDI est complet : une entrée a été refusée à la borne.', 10 * 60_000);
        fail(409, 'Le CDI est complet pour le moment.');
    }
    $expiry = fullHour($clock, ($data['two_hours'] ?? null) === true && $settings['second_hour'] ? 2 : 1);
    addPresence($db, $id, $clock, $expiry, 'individuel', $person['class_name']);
    capacityAlert($db, $clock);
    return ['expires_at' => $expiry, 'already' => false];
}

/** Tableau de bord en direct : présents, places, arrivées, départs proches, planning du jour et état de la borne. */
function liveBoard(Store $db, array $me, int $clock): array
{
    $now = parisClock($clock);
    $start = midnight($now['day'])->getTimestamp() * 1000;
    $internal = $me['admin'] || in_array('planning', $me['rights'], true) || in_array('planning_voir', $me['rights'], true);
    $reason = closure($db, $clock, kioskSettings($db));
    $slots = $db->all('SELECT p.start_min,p.end_min,p.title,p.kind,p.students_allowed,coalesce(c.name,g.name) AS class_name FROM planning p
        LEFT JOIN classes c ON c.id=p.class_id LEFT JOIN school_groups g ON g.id=p.group_id WHERE p.day=? ORDER BY p.start_min', $now['day']);
    if (!$internal) {
        $slots = array_map(static function (array $row): array {
            $closed = $row['kind'] === 'fermeture';
            $refused = !$closed && (int) $row['students_allowed'] === 0;
            return ['start_min' => $row['start_min'], 'end_min' => $row['end_min'], 'kind' => $closed || $refused ? 'fermeture' : 'reservation',
                'title' => $closed ? 'Fermé' : ($refused ? 'Réservé · fermé aux élèves' : 'Réservé'), 'class_name' => null];
        }, $slots);
    }
    return ['now' => $clock, 'minute' => $now['minute']] + occupancy($db, $clock) + [
        'present' => (int) $db->one('SELECT count(*) AS total FROM visits WHERE ended_at IS NULL AND expires_at>?', $clock)['total'],
        'open' => $reason === '', 'reason' => $reason,
        'arrivals' => $db->all('SELECT v.starts_at,v.expires_at,v.source,v.reason,s.first_name,s.last_name,c.name AS class_name FROM visits v
            JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id WHERE v.starts_at>=? ORDER BY v.starts_at DESC LIMIT 8', $start),
        'leaving' => $db->all('SELECT v.expires_at,s.first_name,s.last_name,c.name AS class_name FROM visits v
            JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id WHERE v.ended_at IS NULL AND v.expires_at>? AND v.expires_at<=? ORDER BY v.expires_at LIMIT 10', $clock, $clock + 15 * 60_000),
        'today' => $db->one('SELECT count(*) AS visits,count(DISTINCT student_id) AS students FROM visits WHERE starts_at>=?', $start),
        'classes' => $db->all('SELECT coalesce(v.class_name,c.name) AS name,count(*) AS total FROM visits v
            JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id WHERE v.ended_at IS NULL AND v.expires_at>? GROUP BY coalesce(v.class_name,c.name) ORDER BY total DESC,name LIMIT 12', $clock),
        'planning' => $slots,
        'hours' => $db->all('SELECT start_min,end_min FROM opening_hours WHERE weekday=? ORDER BY start_min', $now['weekday']),
        'events' => recentEvents($db, $clock), 'internal' => $internal,
    ];
}

/** Arrivée enregistrée par le personnel : hors horaires et créneaux réservés, mais jamais pour un élève exclu. */
function manualArrival(Store $db, array $me, array $data, int $clock): array
{
    $student = $data['student_id'] ?? null;
    $two = $data['two_hours'] ?? false;
    $reason = visitReason($data['reason'] ?? null);
    if (!is_string($student) || strlen($student) > 80 || !is_bool($two)) {
        fail(400, 'Sélectionnez un élève.');
    }
    $person = $db->one('SELECT s.id,c.name AS class_name ' . PEOPLE_JOIN . ' WHERE s.id=? AND s.active=1', $student);
    if (!$person) {
        fail(404, 'Élève introuvable ou fiche retirée.');
    }
    $excluded = $db->one('SELECT until_day FROM exclusions WHERE student_id=? AND revoked_at IS NULL AND until_day>=? ORDER BY until_day DESC LIMIT 1', $student, parisClock($clock)['day']);
    if ($excluded) {
        fail(403, 'Cet élève est exclu du CDI jusqu’au ' . implode('/', array_reverse(explode('-', $excluded['until_day']))) . '.');
    }
    $current = activePresence($db, $student, $clock);
    if ($current) {
        if ($reason !== null) {
            $db->run('UPDATE visits SET reason=? WHERE id=?', $reason, $current['id']);
        }
        return ['expires_at' => $current['expires_at'], 'already' => true];
    }
    $gauge = occupancy($db, $clock);
    if ($gauge['places'] === 0) {
        fail(409, 'Le CDI est complet (' . $gauge['capacity'] . ' places). Augmentez la capacité dans les réglages si besoin.');
    }
    $expires = fullHour($clock, $two ? 2 : 1);
    addPresence($db, $student, $clock, $expires, 'individuel', $person['class_name']);
    if ($reason !== null) {
        $db->run('UPDATE visits SET reason=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?', $reason, $student, $clock);
    }
    audit($db, $me, 'presences', 'Arrivée enregistrée par le personnel', 'Présence', null, null);
    capacityAlert($db, $clock);
    return ['expires_at' => $expires, 'already' => false];
}

function presenceResource(Store $db, string $method, ?string $id, array $me, int $clock): array
{
    if ($method === 'GET' && $id === null) {
        need($me, 'presence', 'sorties', 'arrivees');
        $rows = $db->all('SELECT v.id,v.student_id,v.starts_at,v.expires_at,v.source,v.reason,s.first_name,s.last_name,c.name AS class_name
            FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
            WHERE ' . ACTIVE_VISIT . ' ORDER BY v.expires_at,s.last_name', $clock);
        return ['rows' => $rows, 'now' => $clock] + occupancy($db, $clock);
    }
    if ($method === 'PATCH' && $id !== null) {
        $data = requestData();
        // Motif de présence seul : modifiable par les agents qui gèrent les sorties ou les arrivées.
        if (array_key_exists('reason', $data) && !array_key_exists('minutes', $data)) {
            need($me, 'sorties', 'arrivees');
            $reason = visitReason($data['reason']);
            if (!$db->run('UPDATE visits SET reason=? WHERE id=? AND ended_at IS NULL AND expires_at>?', $reason, $id, $clock)) {
                fail(409, 'Cette présence est terminée.');
            }
            return ['reason' => $reason];
        }
    }
    need($me, 'sorties');
    if ($method === 'DELETE' && $id !== null) {
        if (!$db->run('UPDATE visits SET ended_at=? WHERE id=? AND ended_at IS NULL AND expires_at>?', $clock, $id, $clock)) {
            fail(409,'Cette présence est déjà terminée ou son créneau a expiré.');
        }
        return ['ok' => true];
    }
    if ($method === 'PATCH' && $id !== null) {
        $data = requestData();
        $minutes = $data['minutes'] ?? null;
        $expected = $data['expires_at'] ?? null;
        if (!in_array($minutes, [15, 30, 60], true) || !is_int($expected)) {
            fail(400, 'Choisissez une prolongation de 15, 30 ou 60 minutes.');
        }
        $visit = $db->one('SELECT expires_at,ended_at FROM visits WHERE id=?', $id);
        if (!$visit || $visit['ended_at'] !== null || $visit['expires_at'] <= $clock) {
            fail(409, 'Cette présence est terminée.');
        }
        if ($visit['expires_at'] !== $expected) {
            fail(409, 'Le départ prévu a changé. Ouvrez à nouveau la prolongation.');
        }
        $updated = $expected + $minutes * 60_000;
        if (!$db->run('UPDATE visits SET expires_at=? WHERE id=? AND ended_at IS NULL AND expires_at>?', $updated, $id, clockMs())) {
            fail(409, 'Cette présence est terminée.');
        }
        audit($db, $me, 'presences', 'Prolongation de présence', 'Présence', null, null);
        return ['expires_at' => $updated];
    }
    fail(404, 'Action introuvable.');
}

function exclusionsResource(Store $db, string $method, ?string $id, array $me, int $clock): array
{
    need($me, ...($method === 'GET' && $id === null ? ['exclusions', 'exclusions_voir'] : ['exclusions']));
    $today = parisClock($clock)['day'];
    if ($method === 'GET' && $id === null) {
        $rows = $db->all('SELECT e.*,s.first_name,s.last_name,c.name AS class_name FROM exclusions e
            JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=s.class_id ORDER BY e.created_at DESC LIMIT 500');
        return compact('rows', 'today');
    }
    if ($method === 'POST' && $id === null) {
        $data = requestData();
        $reason = label($data['reason'] ?? null, 'Le motif', 500);
        $day = clean($data['until_day'] ?? null);
        $student = label($data['student_id'] ?? null, 'L’élève');
        if (!validDay($day) || $day < $today) {
            fail(400, 'Choisissez une date de fin valide.');
        }
        if (!$db->one('SELECT id FROM students WHERE id=? AND active=1', $student)) {
            fail(404, 'Élève introuvable.');
        }
        $db->run('INSERT INTO exclusions VALUES (?,?,?,?,?,?,NULL)', uid(), $student, $reason, $day, $clock, $me['name']);
        $db->run('UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?', $clock, $student, $clock);
        return ['ok' => true];
    }
    if ($method === 'DELETE' && $id !== null) {
        $db->run('UPDATE exclusions SET revoked_at=? WHERE id=? AND revoked_at IS NULL', $clock, $id);
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

function groupArrival(Store $db, array $body, int $clock): array
{
    $class = $body['class_id'] ?? null;
    $duration = $body['duration'] ?? null;
    $ids = paramIds($body['student_ids'] ?? null, 400);
    if (!is_string($class) || !$ids || !in_array($duration, [60, 120], true)) {
        fail(400, 'Sélectionnez une classe, des élèves présents et une durée.');
    }
    $counts = ['added' => 0, 'already' => 0, 'excluded' => 0, 'unavailable' => 0];
    $places = occupancy($db, $clock)['places'] ?? PHP_INT_MAX;
    $day = parisClock($clock)['day'];
    foreach ($ids as $id) {
        $row = $db->one('SELECT c.name AS class_name ' . PEOPLE_JOIN . ' WHERE s.id=? AND s.class_id=? AND s.active=1', $id, $class);
        $state = match (true) {
            !$row => 'unavailable',
            deniedStudent($db, $id, $day) => 'excluded',
            (bool) activePresence($db, $id, $clock) => 'already',
            $places === 0 => 'full',
            default => 'added',
        };
        $counts[$state] = ($counts[$state] ?? 0) + 1;
        if ($state === 'added') {
            addPresence($db, $id, $clock, fullHour($clock, intdiv($duration, 60)), 'classe', $row['class_name']);
            --$places;
        }
    }
    if ($counts['added'] > 0) {
        capacityAlert($db, $clock);
    }
    return $counts;
}
