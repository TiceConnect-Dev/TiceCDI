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
        return ['user' => authenticate($db, $clock), 'setup' => $setup, 'keyRequired' => true, 'demoAllowed' => false,
            'sso' => ssoPublic(connectionSettings($db))];
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
        $password = is_string($data['password'] ?? null) ? mb_substr($data['password'], 0, 161, 'UTF-8') : '';
        $verified = verifyPassword($password, $account['secret'] ?? null);
        if (!$account || !$verified['ok']) {
            $known = $account ? $db->one('SELECT name,username FROM accounts WHERE id=?', $account['id']) : null;
            audit($db, ['name' => $known['name'] ?? 'Identifiant inconnu'], 'securite', 'Échec de connexion', $known['username'] ?? 'Connexion', null, loginTrace());
            fail(401, 'Identifiant ou mot de passe incorrect.');
        }
        $mfa = $db->one('SELECT * FROM account_mfa WHERE account_id=? AND secret IS NOT NULL', $account['id']);
        if ($mfa) {
            if (clean($data['code'] ?? null) === '') {
                return ['mfa' => true];
            }
            throttle($db, 'mfa:' . $account['id'], 6, 10);
            $profile = $db->one('SELECT name,username FROM accounts WHERE id=?', $account['id']);
            $factor = consumeSecondFactor($db, $account['id'], $mfa, $data['code'], $clock);
            if ($factor === '') {
                audit($db, $profile, 'securite', 'Échec de la double authentification', $profile['username'], null, loginTrace());
                fail(401, 'Code de vérification incorrect.');
            }
            if ($factor === 'secours') {
                audit($db, $profile, 'securite', 'Connexion avec un code de secours', $profile['username'], null, loginTrace());
            }
        }
        $upgraded = $verified['upgrade'] ? passwordSecret($password) : null;
        return $db->atomic(function () use ($db, $account, $clock, $upgraded): array {
            if (!$db->one('SELECT id FROM accounts WHERE id=? AND secret=?', $account['id'], $account['secret'])) {
                fail(401, 'Identifiant ou mot de passe incorrect.');
            }
            if ($upgraded !== null) {
                $db->run('UPDATE accounts SET secret=? WHERE id=?', $upgraded, $account['id']);
            }
            return startLogin($db, $account['id'], $clock);
        });
    }
    if (str_starts_with($path, '/api/auth/sso/')) {
        ssoResource($db, $path, $method, $clock);
    }
    if ($path === '/api/auth/challenge' && $method === 'POST') {
        return challengeLogin($db, $clock);
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
    if ($method === 'GET' && $path === '/api/notice') {
        return noticeData($db);
    }
    if ($method === 'GET' && $path === '/api/planning') {
        if (!privacySettings($db)['public_planning']) {
            fail(403, 'L’écran de planning sans connexion est désactivé.');
        }
        $planning = weekPlanning($db, validateMonday(q('week')), $clock);
        $planning['rows'] = array_map(static function ($slot): array {
            $closed = $slot['kind'] === 'fermeture';
            return array_intersect_key($slot, array_flip(['day','start_min','end_min'])) +
                ['kind' => $closed ? 'fermeture' : 'reservation', 'title' => $closed ? 'Fermé' : 'Réservé', 'class_name' => null];
        }, $planning['rows']);
        // Occupation en temps réel pour l’écran public : uniquement des nombres agrégés.
        $planning['occupancy'] = occupancy($db, $clock);
        return $planning;
    }
    if (!str_starts_with($path, '/api/borne/')) {
        fail(404, 'Action introuvable.');
    }
    $token = $_COOKIE['cdi_device'] ?? '';
    $key = is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token) ? hash('sha256', $token) : '';
    $device = $db->one("SELECT k.token FROM kiosk_devices k JOIN accounts a ON a.id=k.account_id
        WHERE k.token=? AND k.expires_at>? AND (a.admin=1 OR EXISTS(SELECT 1 FROM json_each(a.permissions) WHERE value='borne'))", $key, $clock);
    if ($method === 'GET' && $path === '/api/borne/reglages') {
        if (!$device) {
            return ['activated' => false];
        }
        $settings = kioskSettings($db);
        $reason = closure($db, $clock, $settings);
        $settings['open'] = $reason === '';
        return $settings + occupancy($db, $clock) + ['activated' => true, 'reason' => $reason];
    }
    if (!$device) {
        fail(403, 'Ce poste doit être activé par le personnel.');
    }
    if ($method !== 'POST' || !in_array($path, ['/api/borne/entree','/api/borne/sortie'], true)) {
        fail(404, 'Action introuvable.');
    }
    throttle($db, 'checkin:' . $key, 90);
    $data = requestData();
    return $db->atomic(static function () use ($db, $path, $data): array {
        $now = clockMs();
        if ($path === '/api/borne/entree') {
            return kioskCheckIn($db, $data, $now);
        }
        $code = strtoupper(clean($data['code'] ?? null));
        if (!preg_match('/^CDI[0-9A-F]{10}$/D', $code)) {
            fail(400, 'Scanne ou saisis le code de ta carte CDI.');
        }
        $db->run('UPDATE visits SET ended_at=? WHERE ended_at IS NULL AND expires_at>?
            AND student_id IN (SELECT id FROM students WHERE active=1 AND code=?)', $now, $now, $code);
        return ['ok' => true];
    });
}

function managementResource(Store $db, string $path, string $method, int $clock): array
{
    $me = authenticate($db, $clock);
    if (!$me) {
        fail(401, 'Connectez-vous pour accéder à cet espace.');
    }
    if ($me['mfa_missing'] && !str_starts_with($path, '/api/gestion/securite')) {
        fail(403, 'Votre établissement exige la double authentification : activez-la dans « Sécurité du compte ».');
    }
    $configured = connectionResource($db, $path, $method, $me, $clock);
    if ($configured !== null) {
        return $configured;
    }
    $secured = securityResource($db, $path, $method, $me, $clock);
    if ($secured !== null) {
        return $secured;
    }
    if ($path === '/api/gestion/borne/activation' && in_array($method, ['POST','DELETE'], true)) {
        need($me, 'borne');
        if ($method === 'POST') {
            $token = bin2hex(random_bytes(32));
            $expires = $clock + 12*HOUR_MS;
            $db->run('INSERT INTO kiosk_devices VALUES (?,?,?)', hash('sha256',$token), $me['id'], $expires);
            cookie($token, intdiv($expires,1000), 'cdi_device');
        } elseif ($me['admin']) {
            $db->run('DELETE FROM kiosk_devices');
        } else {
            $db->run('DELETE FROM kiosk_devices WHERE account_id=?', $me['id']);
        }
        audit($db,$me,'confidentialite',$method === 'POST' ? 'Activation d’un poste' : 'Révocation des activations','Borne',null,null);
        return ['ok' => true];
    }
    if ($path === '/api/gestion/confidentialite' && in_array($method, ['GET','PATCH'], true)) {
        adminOnly($me);
        return $method === 'PATCH' ? changePrivacy($db,$me,requestData()) :
            privacySettings($db) + $db->one('SELECT last_success FROM privacy_state WHERE id=1');
    }
    if ($path === '/api/gestion/confidentialite/purge' && $method === 'POST') {
        adminOnly($me);
        return maintain($db,$clock);
    }
    if ($path === '/api/gestion/dossier/recherche' && $method === 'POST') {
        need($me,'donnees');
        $input = clean(requestData()['q'] ?? null);
        $tokens = searchWords($input,8);
        if (mb_strlen(implode('',$tokens),'UTF-8') < 3) {
            return ['rows'=>[]];
        }
        $filter = implode(' AND ',array_fill(0,count($tokens),'instr(s.search_name,?)>0'));
        return ['rows'=>$db->all('SELECT ' . PERSON_COLUMNS . ' ' . PEOPLE_JOIN .
            " WHERE ($filter) OR s.external_id=? ORDER BY s.last_name,s.first_name LIMIT 20", ...[...$tokens,$input])];
    }
    if (preg_match('~^/api/gestion/dossier/([a-f0-9-]+)(/export)?$~D', $path, $matches)) {
        need($me,'donnees');
        $student = $matches[1];
        if (isset($matches[2]) && $method === 'GET') {
            need($me,'export');
            $file = studentFile($db,$student);
            audit($db,$me,'confidentialite','Export d’un dossier','Dossier individuel',null,null);
            header('Content-Disposition: attachment; filename="Dossier-eleve.json"');
            return $file;
        }
        if (!isset($matches[2])) {
            if ($method === 'GET') {
                return studentFile($db,$student);
            }
            if ($method === 'PATCH') {
                $file = studentFile($db,$student);
                $data = requestData();
                $s = studentData($data);
                $class = clean($data['class_id'] ?? null);
                if (!$db->one('SELECT id FROM classes WHERE id=?', $class)) {
                    fail(400, 'Sélectionnez une classe existante.');
                }
                if ($s['external_id'] !== null && $db->one('SELECT id FROM students WHERE external_id=? AND id<>?', $s['external_id'], $student)) {
                    fail(409, 'Cet identifiant externe est déjà utilisé.');
                }
                persistStudent($db,$s,$class,$student,false);
                $db->run('UPDATE attendance_members SET first_name=?,last_name=? WHERE student_id=?',$s['first_name'],$s['last_name'],$student);
                $db->run('UPDATE school_year_members SET first_name=?,last_name=? WHERE student_id=?',$s['first_name'],$s['last_name'],$student);
                audit($db,$me,'confidentialite','Rectification d’un dossier','Dossier individuel',null,null);
                return ['ok'=>true];
            }
            if ($method === 'DELETE') {
                if ((requestData()['confirmation'] ?? null) !== 'EFFACER') {
                    fail(400,'Confirmez l’effacement.');
                }
                studentFile($db,$student);
                task($db,privacySettings($db),$clock,'erase',$student);
                audit($db,$me,'confidentialite','Effacement validé','Dossier individuel',null,null);
                return ['ok'=>true];
            }
        }
    }
    if ($path === '/api/gestion/export' && $method === 'POST') {
        need($me,'export');
        $type = requestData()['type'] ?? '';
        $rights = ['planning'=>'planning','appel'=>'arrivees','statistiques'=>'statistiques','badges'=>'badges','archives'=>'admin'];
        if (!is_string($type) || !isset($rights[$type])) {
            fail(400,'Export inconnu.');
        }
        if ($type === 'archives') {
            adminOnly($me);
        } else {
            need($me,$rights[$type]);
        }
        audit($db,$me,'confidentialite','Export',$type,null,null);
        return ['ok' => true];
    }
    if ($path === '/api/gestion/eleves/recherche' && $method === 'POST') {
        return studentsResource($db,'GET',null,$me,$clock,requestData());
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
        return privateStatistics($db, q('from'), q('to'), $clock);
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
    if (str_starts_with($path, '/api/gestion/sauvegarde')) {
        return backupResource($db, $me, $path, $method, $clock);
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
        need($me,'export');
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
    $ip = clientAddress();
    if (str_starts_with($path, '/api/auth/')) {
        return authResource($db, $path, $method, $clock, $dataDir, $ip);
    }
    if (str_starts_with($path, '/api/gestion/')) {
        return $db->atomic(static fn () => managementResource($db, $path, $method, clockMs()), $method !== 'GET' || preg_match('~/(export|sauvegarde/[a-f0-9-]+)$~D', $path));
    }
    return publicResource($db, $path, $method, $clock, $ip);
}
