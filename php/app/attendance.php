<?php
declare(strict_types=1);

function groups(Store $db, bool $all): array
{
    $onlyActive = $all ? '' : 'WHERE g.active=1';
    return $db->all("SELECT g.id,g.name,g.active,count(s.id) AS total FROM school_groups g
        LEFT JOIN group_members gm ON gm.group_id=g.id LEFT JOIN students s ON s.id=gm.student_id AND s.active=1
        $onlyActive GROUP BY g.id ORDER BY g.active DESC,g.normalized");
}

function members(Store $db, string $id): array
{
    if (!$db->one('SELECT id FROM school_groups WHERE id=?', $id)) {
        fail(404, 'Groupe introuvable.');
    }
    return $db->all('SELECT s.id,s.first_name,s.last_name,c.name AS class_name,s.active FROM group_members g
        JOIN students s ON s.id=g.student_id JOIN classes c ON c.id=s.class_id WHERE g.group_id=?
        ORDER BY s.active DESC,s.last_name,s.first_name', $id);
}

function saveGroup(Store $db, array $me, ?string $id, array $body): array
{
    $name = label($body['name'] ?? null, 'Le nom du groupe', 65);
    $normalized = normalize($name);
    $before = $id === null ? null : $db->one('SELECT name,active FROM school_groups WHERE id=?', $id);
    if ($id !== null && !$before) {
        fail(404, 'Groupe introuvable.');
    }
    $key = $id ?? uid();
    if ($db->one('SELECT id FROM school_groups WHERE normalized=? AND id<>?', $normalized, $key)) {
        fail(409, 'Un groupe porte déjà ce nom.');
    }
    $selected = paramIds($body['student_ids'] ?? null);
    $input = jsonData($selected);
    if ($db->one('SELECT count(*) AS total FROM students WHERE id IN (SELECT value FROM json_each(?))', $input)['total'] !== count($selected)) {
        fail(409, 'Actualisez la liste des élèves du groupe.');
    }
    $previous = $id === null ? [] : members($db, $id);
    $active = ($body['active'] ?? true) !== false;
    $db->run('INSERT INTO school_groups (id,name,normalized,active) VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized=excluded.normalized,active=excluded.active', $key, $name, $normalized, $active);
    $db->run('DELETE FROM group_members WHERE group_id=?', $key);
    $db->run('INSERT INTO group_members SELECT ?,value FROM json_each(?)', $key, $input);
    audit($db, $me, 'groupes', $before ? 'Modification du groupe' : 'Création du groupe', $name,
        $before ? ['nom' => $before['name'], 'actif' => (bool) $before['active'], 'effectif' => count($previous)] : null,
        ['nom' => $name, 'actif' => $active, 'effectif' => count($selected)]);
    return ['id' => $key];
}

function roster(Store $db, mixed $kind, mixed $id): array
{
    if (!in_array($kind, ['classe', 'groupe'], true) || !is_string($id) || $id === '') {
        fail(400, 'Choisissez une classe ou un groupe.');
    }
    $isClass = $kind === 'classe';
    $group = $db->one($isClass ? 'SELECT id,name FROM classes WHERE id=?' : 'SELECT id,name FROM school_groups WHERE id=? AND active=1', $id);
    if (!$group) {
        fail(404, 'La classe ou le groupe n’est pas disponible.');
    }
    $filter = $isClass ? 's.class_id=?' : 'EXISTS (SELECT 1 FROM group_members g WHERE g.group_id=? AND g.student_id=s.id)';
    $rows = $db->all('SELECT ' . PERSON_COLUMNS . ' ' . PEOPLE_JOIN . " WHERE s.active=1 AND $filter ORDER BY s.last_name,s.first_name,s.id", $id);
    return compact('group', 'rows');
}

function sessions(Store $db, int $clock): array
{
    return $db->all("SELECT a.*,count(am.student_id) AS total,sum(CASE WHEN am.status IN('present','retard') THEN 1 ELSE 0 END) AS present,
        sum(CASE WHEN am.status='absent' THEN 1 ELSE 0 END) AS absent,sum(CASE WHEN am.status='attente' THEN 1 ELSE 0 END) AS waiting,
        (SELECT count(*) FROM visits v WHERE v.attendance_id=a.id AND " . ACTIVE_VISIT . ') AS active
        FROM attendance a LEFT JOIN attendance_members am ON am.attendance_id=a.id GROUP BY a.id
        ORDER BY a.started_at DESC,a.id DESC LIMIT 200', $clock);
}

function sessionDetail(Store $db, string $id, int $clock): array
{
    $session = $db->one('SELECT * FROM attendance WHERE id=?', $id);
    if (!$session) {
        fail(404, 'Fiche d’appel introuvable.');
    }
    $rows = $db->all('SELECT am.*,EXISTS(SELECT 1 FROM visits v
        WHERE v.attendance_id=am.attendance_id AND v.student_id=am.student_id AND ' . ACTIVE_VISIT . ') AS active,
        (SELECT min(v.starts_at) FROM visits v WHERE v.attendance_id=am.attendance_id AND v.student_id=am.student_id) AS arrived_at
        FROM attendance_members am WHERE am.attendance_id=? ORDER BY am.last_name,am.first_name,am.student_id', $clock, $id);
    return compact('session', 'rows');
}

function attachPresence(Store $db, array $visit, string $attendance): void
{
    $db->run('UPDATE visits SET attendance_id=? WHERE id=? AND (attendance_id IS NULL
        OR EXISTS (SELECT 1 FROM attendance a WHERE a.id=visits.attendance_id AND a.ended_at IS NOT NULL))', $attendance, $visit['id']);
}

function startAttendance(Store $db, array $me, array $data, int $clock): array
{
    $id = $data['request_id'] ?? null;
    $duration = $data['duration'] ?? null;
    $kind = $data['kind'] ?? null;
    $rosterId = $data['roster_id'] ?? null;
    $planId = $data['plan_id'] ?? null;
    if (!is_string($id) || !preg_match('/^[a-f0-9-]{36}$/Di', $id)
        || !is_int($duration) || $duration < 5 || $duration > 240 || ($planId !== null && !is_string($planId))) {
        fail(400, 'Indiquez une durée de 5 à 240 minutes.');
    }
    $previous = $db->one('SELECT id FROM attendance WHERE id=? OR plan_id=?', $id, $planId);
    if ($previous) {
        return sessionDetail($db, $previous['id'], $clock) + ['reused' => true];
    }
    ['group' => $group, 'rows' => $rows] = roster($db, $kind, $rosterId);
    if (!$rows) {
        fail(409, 'Ce groupe ne contient aucun élève actif.');
    }
    $selected = paramIds($data['student_ids'] ?? null);
    if (array_diff($selected, array_column($rows, 'id'))) {
        fail(409, 'La composition a changé. Rouvrez la fiche d’appel.');
    }
    $today = parisClock($clock)['day'];
    $plan = $planId === null ? null : $db->one('SELECT * FROM planning WHERE id=?', $planId);
    if ($planId !== null && (!$plan || $plan['day'] !== $today || $plan['kind'] === 'fermeture'
        || $plan[$kind === 'classe' ? 'class_id' : 'group_id'] !== $rosterId)) {
        fail(409, 'Ce créneau ne correspond pas à un cours ou une activité du jour pour ce groupe.');
    }
    $title = $plan['title'] ?? (clean($data['title'] ?? null) === '' ? $group['name'] : label($data['title'], 'Le titre de la séance', 80));
    $db->run('INSERT INTO attendance (id,plan_id,roster_kind,roster_id,roster_name,title,started_at,duration,actor) VALUES (?,?,?,?,?,?,?,?,?)',
        $id, $planId, $kind, $rosterId, $group['name'], $title, $clock, $duration, $me['name']);
    audit($db, $me, 'seances', 'Ouverture de la fiche d’appel', $title, null,
        ['groupe' => $group['name'], 'effectif' => count($rows), 'cochés' => count($selected)]);
    $selected = array_fill_keys($selected, true);
    $places = occupancy($db, $clock)['places'] ?? PHP_INT_MAX;
    $expires = fullHour($clock, (int) ceil($duration / 60));
    foreach ($rows as $row) {
        $student = $row['id'];
        $status = 'absent';
        if (isset($selected[$student])) {
            $status = 'attente';
            if (deniedStudent($db, $student, $today)) {
                $status = 'exclu';
            } elseif ($visit = activePresence($db, $student, $clock)) {
                attachPresence($db, $visit, $id);
                $status = 'present';
            } elseif ($places > 0) {
                addPresence($db, $student, $clock, $expires, $kind, $row['class_name'], $id);
                --$places;
                $status = 'present';
            }
        }
        $db->run('INSERT INTO attendance_members VALUES (?,?,?,?,?,?)',
            $id, $student, $row['first_name'], $row['last_name'], $row['class_name'], $status);
    }
    return sessionDetail($db, $id, $clock);
}

function changeCall(Store $db, array $me, string $id, array $body, int $clock): array
{
    $status = $body['status'] ?? null;
    $student = $body['student_id'] ?? null;
    if (!in_array($status, ['present', 'retard', 'absent', 'excuse'], true) || !is_string($student)) {
        fail(400, 'Choisissez un statut valide.');
    }
    $member = $db->one('SELECT am.*,a.title,a.ended_at,a.started_at,a.duration,a.roster_kind
        FROM attendance_members am JOIN attendance a ON a.id=am.attendance_id
        WHERE am.attendance_id=? AND am.student_id=?', $id, $student);
    if (!$member) {
        fail(404, 'Élève introuvable sur cette fiche.');
    }
    if ($member['status'] === $status) {
        return sessionDetail($db, $id, $clock);
    }
    if ($member['ended_at'] === null) {
        $deadline = fullHour($member['started_at'], (int) ceil($member['duration'] / 60));
        if (in_array($status, ['present', 'retard'], true)) {
            if ($deadline > $clock) {
                if (!$db->one('SELECT id FROM students WHERE id=? AND active=1', $student)
                    || deniedStudent($db, $student, parisClock($clock)['day'])) {
                    fail(409, 'L’arrivée n’a pas été enregistrée. Vérifiez la jauge, l’exclusion ou la fiche de l’élève.');
                }
                if ($visit = activePresence($db, $student, $clock)) {
                    attachPresence($db, $visit, $id);
                } else {
                    if (occupancy($db, $clock)['places'] === 0) {
                        fail(409, 'Le CDI est complet pour le moment.');
                    }
                    addPresence($db, $student, $clock, $deadline, $member['roster_kind'], $member['class_name'], $id);
                }
            }
        } else {
            $db->run('UPDATE visits AS v SET ended_at=? WHERE attendance_id=? AND student_id=? AND ' . ACTIVE_VISIT,
                $clock, $id, $student, $clock);
        }
    }
    $db->run('UPDATE attendance_members SET status=? WHERE attendance_id=? AND student_id=?', $status, $id, $student);
    audit($db, $me, 'seances', 'Correction d’un appel', 'Fiche d’appel',
        ['statut' => $member['status']], ['statut' => $status]);
    return sessionDetail($db, $id, $clock);
}

function finishAttendance(Store $db, array $me, string $id, array $body, int $clock): array
{
    $keep = paramIds($body['keep_student_ids'] ?? []);
    $session = sessionDetail($db, $id, $clock)['session'];
    if ($session['ended_at'] !== null) {
        return ['closed' => 0] + sessionDetail($db, $id, $clock);
    }
    $closed = $db->run('UPDATE visits AS v SET ended_at=? WHERE attendance_id=? AND ' . ACTIVE_VISIT .
        ' AND student_id NOT IN (SELECT value FROM json_each(?))', $clock, $id, $clock, jsonData($keep));
    $db->run('UPDATE attendance SET ended_at=? WHERE id=?', $clock, $id);
    audit($db, $me, 'seances', 'Fin de séance', $session['title'], ['état' => 'en cours'],
        ['état' => 'terminée', 'élèves_laissés_au_CDI' => count($keep)]);
    return ['closed' => $closed] + sessionDetail($db, $id, $clock);
}
