<?php
declare(strict_types=1);

function sameOrigin(): void
{
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        fail(403, 'Requête non autorisée.');
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $configured = setting('CDI_ORIGIN');
    $host = strtolower($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== '') {
        $parsed = parse_url($origin);
        $originHost = ($parsed['host'] ?? '') . (isset($parsed['port']) ? ':' . $parsed['port'] : '');
        if ($configured !== '' ? $configured !== $origin : $host !== strtolower($originHost)) {
            fail(403, 'Requête non autorisée.');
        }
    }
}

function authResource(Store $db, string $path, string $method, int $clock, string $dataDir, string $ip): array
{
    if ($path === '/api/auth/status' && $method === 'GET') {
        $setup = !$db->one('SELECT id FROM accounts LIMIT 1');
        if ($setup) {
            ensureSetupKey($dataDir);
        }
        return ['user' => authenticate($db, $clock), 'setup' => $setup, 'keyRequired' => true, 'demoAllowed' => false];
    }
    if ($path === '/api/auth/setup' && $method === 'POST') {
        throttle($db, "setup:$ip", 15, 10);
        $data = requestData();
        if (!is_string($data['key'] ?? null) || !hash_equals(ensureSetupKey($dataDir), $data['key'])) {
            fail(403, 'Clé d’installation incorrecte.');
        }
        $id = uid();
        $login = username($data['username'] ?? null);
        $name = label($data['name'] ?? null, 'Le nom d’affichage');
        $password = passwordSecret(newPassword($data['password'] ?? null));
        return $db->atomic(function () use ($db, $id, $login, $name, $password, $clock): array {
            if ($db->one('SELECT id FROM accounts LIMIT 1')) {
                fail(409, 'Un compte administrateur existe déjà.');
            }
            $db->run("INSERT INTO accounts VALUES (?,?,?,?,'[]',1)", $id, $login, $name, $password);
            return startLogin($db, $id, $clock);
        });
    }
    if ($path === '/api/auth/login' && $method === 'POST') {
        throttle($db, "login:$ip", 30, 10);
        $data = requestData();
        $login = substr(strtolower(clean($data['username'] ?? null)), 0, 80);
        throttle($db, 'account:' . hash('sha256', $login), 12, 10);
        $account = $db->one('SELECT id,secret FROM accounts WHERE username=?', $login);
        $salt = $account ? explode(':', $account['secret'], 2)[0] : str_repeat('0', 32);
        $password = is_string($data['password'] ?? null) ? mb_substr($data['password'], 0, 161, 'UTF-8') : '';
        $secret = passwordSecret($password, $salt);
        if (!$account || !hash_equals($account['secret'], $secret)) {
            fail(401, 'Identifiant ou mot de passe incorrect.');
        }
        return $db->atomic(function () use ($db, $account, $clock): array {
            if (!$db->one('SELECT id FROM accounts WHERE id=? AND secret=?', $account['id'], $account['secret'])) {
                fail(401, 'Identifiant ou mot de passe incorrect.');
            }
            return startLogin($db, $account['id'], $clock);
        });
    }
    if ($path === '/api/auth/logout' && $method === 'POST') {
        $token = sessionToken();
        if ($token !== null) {
            $db->run('DELETE FROM sessions WHERE token=?', hash('sha256', $token));
        }
        cookie('', 1);
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

function publicResource(Store $db, string $path, string $method, int $clock, string $ip): array
{
    if ($path === '/api/borne/entree' && $method === 'POST') {
        throttle($db, "checkin:$ip", 90);
        $data = requestData();
        return $db->atomic(static fn () => kioskCheckIn($db, $data, clockMs()));
    }
    if ($path === '/api/borne/recherche' && $method === 'GET') {
        $query = searchWords(q('q'), 8);
        if (mb_strlen(implode('', $query), 'UTF-8') < 3) {
            return ['results' => []];
        }
        throttle($db, "search:$ip", 140);
        if (closure($db, $clock, kioskSettings($db)) !== '') {
            return ['results' => []];
        }
        $where = str_repeat(' AND instr(s.search_name,?)>0', count($query));
        return ['results' => $db->all('SELECT s.id,s.first_name,s.last_name,c.name AS class_name ' . PEOPLE_JOIN .
            " WHERE s.active=1 $where ORDER BY s.last_name,s.first_name,c.name LIMIT 7", ...$query)];
    }
    if ($method === 'GET' && in_array($path, ['/api/borne/reglages', '/api/planning'], true)) {
        return $db->atomic(static function () use ($db, $path, $clock): array {
            $settings = kioskSettings($db);
            $reason = closure($db, $clock, $settings);
            if ($path === '/api/planning') {
                $details = weekPlanning($db, validateMonday(q('week')), $clock);
            } else {
                $details = $settings;
                unset($details['open']);
            }
            return $details + occupancy($db, $clock) + ['open' => $reason === '', 'reason' => $reason];
        }, false);
    }
    fail(404, 'Action introuvable.');
}

function managementResource(Store $db, string $path, string $method, int $clock): array
{
    $me = authenticate($db, $clock);
    if (!$me) {
        fail(401, 'Connectez-vous pour accéder à cet espace.');
    }
    if (preg_match('~^/api/gestion/(eleves|classes|presences|exclusions|comptes)(?:/([a-f0-9-]+))?$~D', $path, $matches)) {
        $id = $matches[2] ?? null;
        return match ($matches[1]) {
            'eleves' => studentsResource($db, $method, $id, $me, $clock),
            'classes' => classesResource($db, $method, $id, $me),
            'presences' => presenceResource($db, $method, $id, $me, $clock),
            'exclusions' => exclusionsResource($db, $method, $id, $me, $clock),
            'comptes' => accountsResource($db, $method, $id, $me, $clock),
        };
    }
    if ($path === '/api/gestion/reglages' && in_array($method, ['GET', 'PATCH'], true)) {
        adminOnly($me);
        return $method === 'GET' ? kioskSettings($db) : changeKioskSettings($db, $me, requestData());
    }
    if ($path === '/api/gestion/horaires' && in_array($method, ['GET', 'PATCH'], true)) {
        adminOnly($me);
        return $method === 'GET' ? openingHours($db) : changeOpeningHours($db, $me, requestData());
    }
    if ($path === '/api/gestion/arrivees' && in_array($method, ['GET', 'POST'], true)) {
        need($me, 'arrivees');
        if ($method === 'POST') {
            return groupArrival($db, requestData(), $clock);
        }
        $id = q('class');
        if ($id === '' || !$db->one('SELECT id FROM classes WHERE id=?', $id)) {
            fail(404, 'Sélectionnez une classe existante.');
        }
        return ['rows' => $db->all('SELECT id,first_name,last_name FROM students WHERE class_id=? AND active=1 ORDER BY last_name,first_name,id', $id)];
    }
    if ($path === '/api/gestion/statistiques' && $method === 'GET') {
        need($me, 'statistiques');
        return statistics($db, q('from'), q('to'), $clock);
    }
    if ($path === '/api/gestion/planning' && in_array($method, ['GET', 'POST'], true)) {
        need($me, 'planning');
        return $method === 'GET' ? weekPlanning($db, validateMonday(q('week')), $clock, true)
            : changeSlot($db, $me, null, requestData());
    }
    if ($path === '/api/gestion/planning/copier' && $method === 'POST') {
        need($me, 'planning');
        return duplicateWeek($db, $me, validateMonday(requestData()['start'] ?? null));
    }
    if (in_array($method, ['PATCH', 'DELETE'], true) && preg_match('~^/api/gestion/planning/([a-f0-9-]+)$~D', $path, $matches)) {
        need($me, 'planning');
        $id = $matches[1];
        if ($method === 'PATCH') {
            return changeSlot($db, $me, $id, requestData());
        }
        $before = $db->one('SELECT day,start_min,end_min,title,kind FROM planning WHERE id=?', $id);
        if (!$before) {
            fail(404, 'Créneau introuvable.');
        }
        $db->run('DELETE FROM planning WHERE id=?', $id);
        audit($db, $me, 'planning', 'Suppression du créneau', $before['title'], $before, null);
        return ['ok' => true];
    }
    if ($path === '/api/gestion/groupes' && in_array($method, ['GET', 'POST'], true)) {
        if ($method === 'GET') {
            need($me, 'groupes', 'arrivees', 'planning');
            return ['rows' => groups($db, in_array('groupes', $me['rights'], true))];
        }
        need($me, 'groupes');
        return saveGroup($db, $me, null, requestData());
    }
    if (in_array($method, ['GET', 'PATCH'], true) && preg_match('~^/api/gestion/groupes/([a-f0-9-]+)$~D', $path, $matches)) {
        need($me, 'groupes');
        return $method === 'GET' ? ['rows' => members($db, $matches[1])] : saveGroup($db, $me, $matches[1], requestData());
    }
    if ($path === '/api/gestion/seances/effectif' && $method === 'GET') {
        need($me, 'arrivees');
        return roster($db, q('kind'), q('id'));
    }
    if ($path === '/api/gestion/seances' && in_array($method, ['GET', 'POST'], true)) {
        need($me, 'arrivees');
        return $method === 'GET' ? ['rows' => sessions($db, $clock)] : startAttendance($db, $me, requestData(), $clock);
    }
    if (preg_match('~^/api/gestion/seances/([a-f0-9-]+)(/fin)?$~D', $path, $matches)) {
        need($me, 'arrivees');
        $id = $matches[1];
        if (isset($matches[2]) && $method === 'POST') {
            return finishAttendance($db, $me, $id, requestData(), $clock);
        }
        if (!isset($matches[2])) {
            if ($method === 'GET') {
                return sessionDetail($db, $id, $clock);
            }
            if ($method === 'PATCH') {
                return changeCall($db, $me, $id, requestData(), $clock);
            }
        }
    }
    if ($path === '/api/gestion/sauvegarde' && in_array($method, ['GET', 'POST'], true)) {
        return backupResource($db, $me, $method, $clock);
    }
    if ($path === '/api/gestion/journal' && $method === 'GET') {
        adminOnly($me);
        return journal($db, $clock);
    }
    if ($path === '/api/gestion/annees' && in_array($method, ['GET', 'POST'], true)) {
        adminOnly($me);
        $day = parisClock($clock)['day'];
        return $method === 'GET' ? schoolYears($db, $day) : rollYear($db, $me, requestData(), $clock, $day);
    }
    if ($method === 'GET' && preg_match('~^/api/gestion/annees/(\d{4}-\d{4})$~D', $path, $matches)) {
        adminOnly($me);
        if (!$db->one('SELECT label FROM school_year WHERE label=? AND closed_at IS NOT NULL', $matches[1])) {
            fail(404, 'Archive d’année scolaire introuvable.');
        }
        return ['rows' => $db->all('SELECT first_name,last_name,class_name FROM school_year_members WHERE year_label=?
            ORDER BY last_name,first_name,student_id', $matches[1])];
    }
    if ($path === '/api/gestion/import' && $method === 'POST') {
        need($me, 'import');
        return importStudents($db, requestData());
    }
    fail(404, 'Action introuvable.');
}

function api(Store $db, string $path, string $method, string $dataDir): array
{
    $clock = clockMs();
    if ($method !== 'GET') {
        sameOrigin();
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'borne';
    if (str_starts_with($path, '/api/auth/')) {
        return authResource($db, $path, $method, $clock, $dataDir, $ip);
    }
    if (str_starts_with($path, '/api/gestion/')) {
        return $db->atomic(static fn () => managementResource($db, $path, $method, clockMs()), $method !== 'GET');
    }
    return publicResource($db, $path, $method, $clock, $ip);
}
