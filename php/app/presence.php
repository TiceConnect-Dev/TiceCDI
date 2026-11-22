<?php
declare(strict_types=1);

function occupancy(Store $db, int $clock): array
{
    $state = $db->one('SELECT (SELECT capacity FROM kiosk_settings WHERE id=1) AS capacity,
        (SELECT count(*) FROM visits WHERE ended_at IS NULL AND expires_at>?) AS occupied', $clock);
    return $state + ['places' => $state['capacity'] === null ? null : max(0, $state['capacity'] - $state['occupied'])];
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
    $person = $db->one('SELECT s.id,c.name AS class_name ' . PEOPLE_JOIN . ' WHERE s.active=1 AND s.code=?', $code);
    if (!$person) {
        fail(404, 'Carte introuvable. Vérifie le code ou adresse-toi au personnel.');
    }
    $id = $person['id'];
    if (deniedStudent($db, $id, parisClock($clock)['day'])) {
        fail(403, 'L’entrée n’a pas pu être enregistrée. Adresse-toi à l’accueil du CDI.');
    }
    $existing = activePresence($db, $id, $clock);
    if ($existing) {
        return ['expires_at' => $existing['expires_at'], 'already' => true];
    }
    if (occupancy($db, $clock)['places'] === 0) {
        fail(409, 'Le CDI est complet pour le moment.');
    }
    $expiry = fullHour($clock, ($data['two_hours'] ?? null) === true && $settings['second_hour'] ? 2 : 1);
    addPresence($db, $id, $clock, $expiry, 'individuel', $person['class_name']);
    return ['expires_at' => $expiry, 'already' => false];
}

function presenceResource(Store $db, string $method, ?string $id, array $me, int $clock): array
{
    if ($method === 'GET' && $id === null) {
        need($me, 'presence', 'sorties', 'arrivees');
        $rows = $db->all('SELECT v.id,v.student_id,v.starts_at,v.expires_at,v.source,s.first_name,s.last_name,c.name AS class_name
            FROM visits v JOIN students s ON s.id=v.student_id JOIN classes c ON c.id=s.class_id
            WHERE ' . ACTIVE_VISIT . ' ORDER BY v.expires_at,s.last_name', $clock);
        return ['rows' => $rows, 'now' => $clock] + occupancy($db, $clock);
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
    return $counts;
}
