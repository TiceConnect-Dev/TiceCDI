<?php
declare(strict_types=1);

const PERSON_COLUMNS = 's.id,s.first_name,s.last_name,c.name AS class_name,s.class_id';
const PEOPLE_JOIN = 'FROM students s JOIN classes c ON c.id=s.class_id';
const ACTIVE_VISIT = 'v.ended_at IS NULL AND v.expires_at>?';

function studentData(array $body): array
{
    $first = label($body['first_name'] ?? null, 'Le prénom', 75);
    $last = label($body['last_name'] ?? null, 'Le nom', 75);
    $firstKey = words($first);
    $lastKey = words($last);
    if ($firstKey === '' || $lastKey === '') {
        fail(400, 'Saisissez un nom et un prénom valides.');
    }
    $external = clean($body['external_id'] ?? null);
    if (mb_strlen($external, 'UTF-8') > 120) {
        fail(400, 'L’identifiant externe dépasse 120 caractères.');
    }
    return ['first_name' => $first, 'last_name' => $last, 'name_key' => "$lastKey|$firstKey",
        'search_name' => words("$first $last"), 'external_id' => $external === '' ? null : $external];
}

function className(mixed $value): string
{
    return label($value, 'Le nom de la classe', 45);
}

function insertClass(Store $db, string $name): string
{
    $key = normalize($name);
    $existing = $db->one('SELECT id FROM classes WHERE normalized=?', $key);
    if ($existing) {
        return $existing['id'];
    }
    $id = uid();
    $db->run('INSERT INTO classes VALUES (?,?,?)', $id, $name, $key);
    return $id;
}

function persistStudent(Store $db, array $s, string $class, ?string $existing, bool $activate): void
{
    $fields = [$s['first_name'], $s['last_name'], $s['search_name'], $s['name_key'], $class];
    if ($existing === null) {
        $db->run('INSERT INTO students VALUES (?,?,?,?,?,?,?,?,1)', uid(), ...[...$fields, barcode(), $s['external_id']]);
        return;
    }
    $db->run('UPDATE students SET first_name=?,last_name=?,search_name=?,name_key=?,class_id=?,
        external_id=?,active=CASE WHEN ?=1 THEN 1 ELSE active END WHERE id=?',
        ...[...$fields, $s['external_id'], $activate, $existing]);
}

function importStudents(Store $db, array $body): array
{
    $rows = $body['rows'] ?? null;
    if (!is_array($rows) || !array_is_list($rows) || count($rows) < 1 || count($rows) > 5000) {
        fail(400, 'L’import accepte de 1 à 5 000 lignes.');
    }
    $classes = array_column($db->all('SELECT * FROM classes'), 'id', 'normalized');
    $students = $db->all('SELECT s.id,s.external_id,s.name_key,c.normalized AS class_key ' . PEOPLE_JOIN);
    $byRef = $byName = [];
    foreach ($students as $student) {
        $byName[$student['name_key'] . '|' . $student['class_key']][] = $student;
        if ($student['external_id'] !== null) {
            $byRef[$student['external_id']] = $student;
        }
    }
    $incoming = $classNames = $seen = $targeted = $errors = [];
    $added = $updated = $skipped = 0;
    foreach ($rows as $i => $raw) {
        try {
            if (!is_array($raw)) {
                fail(400, 'Ligne invalide.');
            }
            $s = studentData($raw);
            $name = className($raw['class_name'] ?? null);
            $key = normalize($name);
            $nameClass = $s['name_key'] . '|' . $key;
            $ref = $s['external_id'];
            $inputKey = $ref !== null ? 'ref:' . $ref : 'name:' . $nameClass;
            if (isset($seen[$inputKey])) {
                ++$skipped;
                continue;
            }
            $existing = $ref === null ? null : ($byRef[$ref] ?? null);
            if (!$existing) {
                $matches = $byName[$nameClass] ?? [];
                if ($ref !== null) {
                    $matches = array_values(array_filter($matches, static fn ($row) => $row['external_id'] === null));
                }
                if (count($matches) > 1) {
                    fail(409, 'Plusieurs élèves correspondent. Utilisez un identifiant externe unique.');
                }
                $existing = $matches[0] ?? null;
            }
            $id = $existing['id'] ?? null;
            if ($id !== null && isset($targeted[$id])) {
                fail(409, 'Cet élève apparaît plusieurs fois dans le fichier.');
            }
            $seen[$inputKey] = true;
            if (!isset($classes[$key])) {
                $classNames[$key] ??= $name;
            }
            if ($id === null) {
                ++$added;
            } else {
                $targeted[$id] = true;
                $s['external_id'] ??= $existing['external_id'];
                ++$updated;
            }
            $incoming[] = [$s, $key, $id];
        } catch (RequestError $error) {
            $errors[] = ['line' => $i + 2, 'message' => $error->getMessage()];
        }
    }
    $result = ['added' => $added, 'updated' => $updated, 'classes' => count($classNames),
        'skipped' => $skipped, 'errors' => $errors];
    if (!empty($body['preview'])) {
        return $result;
    }
    if ($errors) {
        fail(400, 'Corrigez les lignes signalées avant de confirmer l’import.');
    }
    foreach ($classNames as $key => $name) {
        $classes[$key] = insertClass($db, $name);
    }
    // Appliquer les changements de classe avant de rechercher les doublons parmi les nouvelles fiches.
    foreach ($incoming as [$s, $key, $id]) {
        if ($id !== null) {
            persistStudent($db, $s, $classes[$key], $id, true);
        }
    }
    foreach ($incoming as [$s, $key, $id]) {
        if ($id !== null) {
            continue;
        }
        $class = $classes[$key];
        if ($s['external_id'] === null &&
            $db->one('SELECT id FROM students WHERE name_key=? AND class_id=?', $s['name_key'], $class)) {
            --$result['added'];
            ++$result['skipped'];
            continue;
        }
        persistStudent($db, $s, $class, null, true);
    }
    return $result;
}

function classesResource(Store $db, string $method, ?string $id, array $me): array
{
    if ($method === 'GET' && $id === null) {
        need($me, 'classes', 'classes_voir', 'eleves', 'eleves_voir', 'badges', 'import', 'presence', 'sorties', 'arrivees', 'seances_voir',
            'planning', 'planning_voir', 'groupes', 'groupes_voir', 'exclusions', 'exclusions_voir', 'donnees');
        return ['rows' => $db->all('SELECT c.id,c.name,(SELECT count(*) FROM students s
            WHERE s.class_id=c.id AND s.active=1) AS total FROM classes c ORDER BY c.normalized')];
    }
    need($me, 'classes');
    if ($method === 'DELETE' && $id !== null) {
        // Les élèves actifs vont dans la classe choisie ; les fiches retirées rejoignent « Anciens élèves » si aucune classe n’est choisie.
        $current = $db->one('SELECT name,(SELECT count(*) FROM students WHERE class_id=c.id AND active=1) AS active,
            (SELECT count(*) FROM students WHERE class_id=c.id AND active=0) AS retired FROM classes c WHERE id=?', $id);
        if (!$current) {
            fail(404, 'Classe introuvable.');
        }
        try {
            $data = requestData();
        } catch (Throwable) {
            $data = [];
        }
        $target = is_string($data['move_to'] ?? null) && $data['move_to'] !== '' ? $data['move_to'] : null;
        if ($target !== null && ($target === $id || !$db->one('SELECT id FROM classes WHERE id=?', $target))) {
            fail(400, 'Choisissez une autre classe existante.');
        }
        $active = (int) $current['active'];
        $retired = (int) $current['retired'];
        if ($active > 0 && $target === null) {
            fail(409, 'Choisissez la classe qui accueillera les ' . $active . ' élève' . ($active > 1 ? 's' : '') . ' de ' . $current['name'] . '.');
        }
        if ($target === null && $retired > 0) {
            $target = $db->one("SELECT id FROM classes WHERE normalized='anciens eleves'")['id'] ?? null;
            if ($target === null) {
                $target = uid();
                $db->run("INSERT INTO classes VALUES (?,'Anciens élèves','anciens eleves')", $target);
            }
            if ($target === $id) {
                fail(409, 'La classe « Anciens élèves » conserve les fiches retirées.');
            }
        }
        if ($target !== null) {
            $db->run('UPDATE students SET class_id=? WHERE class_id=?', $target, $id);
        }
        $db->run('DELETE FROM classes WHERE id=?', $id);
        audit($db, $me, 'confidentialite', 'Suppression d’une classe', $current['name'], null, ['eleves_deplaces' => $active + $retired]);
        return ['ok' => true, 'moved' => $active + $retired];
    }
    if (($method === 'POST' && $id === null) || ($method === 'PATCH' && $id !== null)) {
        $name = className(requestData()['name'] ?? null);
        $normalized = normalize($name);
        if ($db->one('SELECT id FROM classes WHERE normalized=? AND id<>?', $normalized, $id ?? '')) {
            fail(409, 'Cette classe existe déjà.');
        }
        if ($id === null) {
            $db->run('INSERT INTO classes VALUES (?,?,?)', uid(), $name, $normalized);
        } elseif (!$db->run('UPDATE classes SET name=?,normalized=? WHERE id=?', $name, $normalized, $id)) {
            fail(404, 'Classe introuvable.');
        }
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

function searchWords(string $query, int $limit): array
{
    $text = words(mb_substr($query, 0, 90, 'UTF-8'));
    return $text === '' ? [] : array_slice(explode(' ', $text), 0, $limit);
}

function studentsResource(Store $db, string $method, ?string $id, array $me, int $clock, ?array $filters=null): array
{
    if ($method === 'GET' && $id === null) {
        $badges = ($filters['badges'] ?? q('badges')) === '1';
        if ($badges) {
            need($me, 'export');
        }
        need($me, ...($badges ? ['badges'] : ['eleves', 'eleves_voir', 'exclusions', 'groupes']));
        $canEdit = in_array('eleves', $me['rights'], true);
        $active = $badges || !$canEdit || ($filters['archived'] ?? q('archived')) !== '1';
        $class = clean($filters['class'] ?? q('class'));
        $search = searchWords(clean($filters['q'] ?? null), 8);
        $where = str_repeat(' AND instr(s.search_name,?)>0', count($search));
        $extra = $badges ? ',s.code' : '';
        $external = !$badges && $canEdit ? ',s.external_id' : '';
        return ['rows' => $db->all('SELECT ' . PERSON_COLUMNS . $extra . $external . ' ' . PEOPLE_JOIN .
            " WHERE s.active=? AND (?='' OR s.class_id=?) $where ORDER BY s.last_name,s.first_name,c.name LIMIT 5000",
            $active, $class, $class, ...$search)];
    }
    need($me, 'eleves');
    if (($method === 'POST' && $id === null) || ($method === 'PATCH' && $id !== null)) {
        $data = requestData();
        $s = studentData($data);
        $class = clean($data['class_id'] ?? null);
        if (!$db->one('SELECT id FROM classes WHERE id=?', $class)) {
            fail(400, 'Sélectionnez une classe existante.');
        }
        if ($s['external_id'] !== null &&
            $db->one('SELECT id FROM students WHERE external_id=? AND id<>?', $s['external_id'], $id ?? '')) {
            fail(409, 'Cet identifiant externe est déjà utilisé.');
        }
        if ($id !== null && !$db->one('SELECT id FROM students WHERE id=?', $id)) {
            fail(404, 'Élève introuvable.');
        }
        persistStudent($db, $s, $class, $id, ($data['reactivate'] ?? null) === true);
        return ['ok' => true];
    }
    if ($method === 'DELETE' && $id !== null) {
        $db->run('UPDATE students SET active=0 WHERE id=?', $id);
        $db->run('UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?', $clock, $id, $clock);
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

function accountsResource(Store $db, string $method, ?string $id, array $me, int $clock): array
{
    need($me, 'comptes');
    if ($method === 'GET' && $id === null) {
        $rows = $db->all('SELECT a.*,EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS mfa FROM accounts a ORDER BY a.admin DESC,a.name');
        return ['rows' => array_map(static fn ($row) => publicAccount($row) + ['mfa' => (bool) $row['mfa']], $rows)];
    }
    $target = $id === null ? null : $db->one('SELECT * FROM accounts WHERE id=?', $id);
    if ($id !== null && !$target) {
        fail(404, 'Compte introuvable.');
    }
    if ($target && !$me['admin'] &&
        ($target['admin'] || array_diff(publicAccount($target)['rights'], $me['rights']))) {
        fail(403, 'Ce compte ne peut pas être modifié avec vos droits.');
    }
    if ($method === 'DELETE' && $target) {
        if ($id === $me['id']) {
            fail(409, 'Votre compte ne peut pas être supprimé depuis votre session.');
        }
        if (!$db->run('DELETE FROM accounts WHERE id=? AND (admin=0 OR (SELECT count(*) FROM accounts WHERE admin=1)>1)', $id)) {
            fail(409, 'Au moins un compte administrateur doit rester actif.');
        }
        audit($db, $me, 'confidentialite', 'Suppression d’un compte', 'Comptes', null, null);
        return ['ok' => true];
    }
    if (($method === 'POST' && !$target) || ($method === 'PATCH' && $target)) {
        $data = requestData();
        $login = username($data['username'] ?? null);
        $name = label($data['name'] ?? null, 'Le nom d’affichage');
        $admin = ($data['admin'] ?? null) === true;
        if ($admin && !$me['admin']) {
            fail(403, 'Seul un administrateur peut accorder l’accès complet.');
        }
        if ($id === $me['id'] && !$admin) {
            fail(409, 'Vos propres droits sont protégés.');
        }
        $received = is_array($data['rights'] ?? null) ? $data['rights'] : [];
        $rights = array_values(array_filter(RIGHTS, static fn ($right) => in_array($right, $received, true)));
        if (!$admin && !$rights) {
            fail(400, 'Sélectionnez au moins un droit.');
        }
        if (!$me['admin'] && array_diff($rights, $me['rights'])) {
            fail(403, 'Vous ne pouvez accorder que vos propres droits.');
        }
        if ($db->one('SELECT id FROM accounts WHERE username=? AND id<>?', $login, $id ?? '')) {
            fail(409, 'Cet identifiant est déjà utilisé.');
        }
        $password = $data['password'] ?? '';
        $secret = !$target || $password !== '' ? passwordSecret(newPassword($password)) : $target['secret'];
        if (!$target) {
            $db->run('INSERT INTO accounts VALUES (?,?,?,?,?,?)', uid(), $login, $name, $secret, jsonData($rights), $admin);
            audit($db, $me, 'confidentialite', 'Création d’un compte', 'Comptes', null, null);
            return ['ok' => true];
        }
        if (!$db->run('UPDATE accounts SET username=?,name=?,secret=?,permissions=?,admin=?
            WHERE id=? AND (admin=0 OR ?=1 OR (SELECT count(*) FROM accounts WHERE admin=1)>1)',
            $login, $name, $secret, jsonData($rights), $admin, $id, $admin)) {
            fail(409, 'Au moins un compte administrateur doit rester actif.');
        }
        audit($db, $me, 'confidentialite', 'Modification d’un compte ou de ses droits', 'Comptes', null, null);
        if ($secret !== $target['secret']) {
            $db->run('DELETE FROM sessions WHERE account_id=?', $id);
            if ($id === $me['id']) {
                return startLogin($db, $id, $clock);
            }
        }
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

function schoolYears(Store $db, string $day): array
{
    $rows = $db->all('SELECT y.label,y.opened_at,y.closed_at,y.actor,
        (SELECT count(*) FROM school_year_members a WHERE a.year_label=y.label) AS total
        FROM school_year y ORDER BY y.label DESC');
    $year = (int) substr($day, 0, 4) - ((int) substr($day, 5, 2) < 9 ? 1 : 0);
    foreach ($rows as $row) {
        if ($row['closed_at'] === null) {
            $year = (int) substr($row['label'], 0, 4);
            break;
        }
    }
    return ['current' => $year . '-' . ($year + 1), 'next' => ($year + 1) . '-' . ($year + 2),
        'initialized' => (bool) $rows, 'rows' => $rows];
}

function rollYear(Store $db, array $me, array $body, int $clock, string $day): array
{
    $from = $body['from'] ?? '';
    $to = $body['to'] ?? '';
    if (!is_string($from) || !preg_match('/^(20\d{2})-(\d{4})$/D', $from, $years)
        || (int) $years[2] !== (int) $years[1] + 1
        || $to !== $years[2] . '-' . ((int) $years[2] + 1) || (int) $years[2] >= 2100) {
        fail(400, 'Indiquez deux années scolaires consécutives.');
    }
    $current = schoolYears($db, $day);
    if ($current['initialized'] && $current['current'] !== $from) {
        fail(409, 'L’année active a changé. Chargez un nouvel aperçu.');
    }
    $rows = $body['rows'] ?? null;
    if (!is_array($rows) || !array_is_list($rows) || count($rows) < 1 || count($rows) > 5000) {
        fail(400, 'Le fichier complet doit contenir de 1 à 5 000 lignes.');
    }
    $incoming = $errors = [];
    foreach ($rows as $index => $raw) {
        try {
            $s = studentData(is_array($raw) ? $raw : []);
            $ref = $s['external_id'];
            if ($ref === null || isset($incoming[$ref])) {
                fail(400, 'Un identifiant externe unique est obligatoire pour chaque élève.');
            }
            $name = className($raw['class_name'] ?? null);
            $incoming[$ref] = $s + ['class_name' => $name, 'class_key' => normalize($name)];
        } catch (RequestError $error) {
            $errors[] = ['line' => $index + 2, 'message' => $error->getMessage()];
        }
    }
    if ($errors) {
        return ['errors' => $errors];
    }
    $previous = $db->all('SELECT s.*,c.name AS class_name,c.normalized AS class_key ' . PEOPLE_JOIN .
        ' ORDER BY s.last_name,s.first_name,s.id');
    $existing = $leaving = $newcomers = $moves = [];
    $reactivated = 0;
    $slim = static fn ($row) => array_intersect_key($row, array_flip(['first_name', 'last_name', 'class_name']));
    foreach ($previous as $s) {
        if ($s['external_id'] !== null) {
            $existing[$s['external_id']] = $s;
        }
        if ($s['active'] && ($s['external_id'] === null || !isset($incoming[$s['external_id']]))) {
            $leaving[] = $slim($s);
        }
    }
    foreach ($incoming as $ref => $s) {
        $before = $existing[$ref] ?? null;
        if (!$before) {
            $newcomers[] = $slim($s);
        } else {
            $reactivated += (int) !$before['active'];
            if ($s['class_key'] !== $before['class_key']) {
                $moves[] = $slim($s) + ['before' => $before['class_name']];
            }
        }
    }
    $counts = ['rookies' => count($newcomers), 'retained' => count($incoming) - count($newcomers),
        'reactivated' => $reactivated, 'archived' => count($leaving), 'moved' => count($moves), 'total' => count($incoming)];
    $verification = hash('sha256', jsonData([$from, $to, $current['initialized'], $previous, $incoming]));
    if (empty($body['token'])) {
        return ['token' => $verification, 'counts' => $counts, 'errors' => [], 'leaving' => array_slice($leaving, 0, 50),
            'newcomers' => array_slice($newcomers, 0, 25), 'moves' => array_slice($moves, 0, 25)];
    }
    if (!is_string($body['token']) || !hash_equals($verification, $body['token'])) {
        fail(409, 'Les fiches ou le fichier ont changé. Refaites l’aperçu avant d’appliquer.');
    }
    if (!$current['initialized']) {
        $db->run('INSERT INTO school_year (label,opened_at,actor) VALUES (?,?,?)', $from, $clock, $me['name']);
    }
    $db->run('INSERT INTO school_year (label,transition_id,opened_at,actor) VALUES (?,?,?,?)', $to, uid(), $clock, $me['name']);
    $db->run('INSERT INTO school_year_members (year_label,student_id,first_name,last_name,class_name)
        SELECT ?,s.id,s.first_name,s.last_name,c.name ' . PEOPLE_JOIN . ' WHERE s.active=1', $from);
    $db->run('UPDATE school_year SET closed_at=? WHERE label=?', $clock, $from);
    foreach ($previous as $s) {
        if ($s['active'] && ($s['external_id'] === null || !isset($incoming[$s['external_id']]))) {
            $db->run('UPDATE students SET active=0 WHERE id=?', $s['id']);
            $db->run('UPDATE visits SET ended_at=? WHERE student_id=? AND ended_at IS NULL AND expires_at>?', $clock, $s['id'], $clock);
        }
    }
    $classes = [];
    foreach ($incoming as $ref => $s) {
        $classes[$s['class_key']] ??= insertClass($db, $s['class_name']);
        persistStudent($db, $s, $classes[$s['class_key']], $existing[$ref]['id'] ?? null, true);
    }
    audit($db, $me, 'annees', 'Passage à la nouvelle année', $to, ['année' => $from], $counts);
    return ['ok' => true, 'current' => $to];
}
