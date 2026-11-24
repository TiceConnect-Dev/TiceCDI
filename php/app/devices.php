<?php
declare(strict_types=1);

// Postes de borne : durée d'activation, renouvellement automatique et gestion des postes activés.
// Logique identique à cdi/devices.mjs (édition Docker).

const DEVICE_DURATIONS = ['12h' => 43_200_000, '7j' => 604_800_000, '30j' => 2_592_000_000, 'annee' => null];

function schoolYearEnd(int $clock): int
{
    $date = new DateTimeImmutable('@' . intdiv($clock, 1000));
    $year = (int) $date->format('n') >= 9 ? (int) $date->format('Y') + 1 : (int) $date->format('Y');
    return (int) gmmktime(21, 59, 59, 8, 31, $year) * 1000;
}

function deviceSettings(Store $db): array
{
    $row = $db->one('SELECT duration,renew,name_search FROM kiosk_device_settings WHERE id=1');
    return ['duration' => $row['duration'] ?? '30j', 'renew' => $row ? (int) $row['renew'] === 1 : true,
        'name_search' => $row ? (int) $row['name_search'] === 1 : true];
}

function deviceExpiry(array $settings, int $clock): int
{
    return $settings['duration'] === 'annee' ? schoolYearEnd($clock) : $clock + DEVICE_DURATIONS[$settings['duration']];
}

/** Dernière activité (au plus une fois par minute) et prolongation glissante ; renvoie la nouvelle échéance si le cookie doit être renouvelé. */
function touchDevice(Store $db, array $device, int $clock): ?int
{
    if ((int) $device['last_seen'] > $clock - 60_000) {
        return null;
    }
    $settings = deviceSettings($db);
    $next = deviceExpiry($settings, $clock);
    $renew = $settings['renew'] && $settings['duration'] !== 'annee' && $next - (int) $device['expires_at'] > 3_600_000;
    $db->run('UPDATE kiosk_devices SET last_seen=?,expires_at=? WHERE token=?', $clock, $renew ? $next : (int) $device['expires_at'], $device['token']);
    return $renew ? $next : null;
}

/** Activation par code : 8 chiffres, valable 10 minutes, à usage unique. Même règle que cdi/devices.mjs. */
const KIOSK_CODE_TTL = 600_000;
const AZERTY_DIGITS = ['&' => '1', 'é' => '2', 'É' => '2', '"' => '3', "'" => '4', '(' => '5',
    '-' => '6', '§' => '6', 'è' => '7', 'È' => '7', '_' => '8', '!' => '8', 'ç' => '9', 'Ç' => '9', 'à' => '0', 'À' => '0'];

function codeDigest(string $code): string
{
    return hash('sha256', 'kiosk-code:' . $code);
}

function newActivationCode(): string
{
    return str_pad((string) random_int(0, 99_999_999), 8, '0', STR_PAD_LEFT);
}

/** Saisie de la borne : espaces ignorés, chiffres AZERTY acceptés (« - » vaut 6, sauf comme séparateur « 1234-5678 »). */
function activationCode(mixed $value): string
{
    if (!is_string($value)) {
        return '';
    }
    $text = preg_replace('/\s+/u', '', mb_substr($value, 0, 40, 'UTF-8')) ?? '';
    foreach ([strtr($text, AZERTY_DIGITS), strtr(str_replace('-', '', $text), AZERTY_DIGITS)] as $code) {
        if (preg_match('/^[0-9]{8}$/D', $code)) {
            return $code;
        }
    }
    return '';
}

function devicesResource(Store $db, string $path, string $method, array $me, int $clock): ?array
{
    if (!str_starts_with($path, '/api/gestion/borne/postes') && $path !== '/api/gestion/borne/code') {
        return null;
    }
    need($me, 'borne');
    if ($path === '/api/gestion/borne/code' && $method === 'POST') {
        $data = ($_SERVER['CONTENT_TYPE'] ?? '') !== '' ? requestData() : [];
        $label = mb_substr(clean($data['label'] ?? null), 0, 60, 'UTF-8');
        $code = newActivationCode();
        $expires = $clock + KIOSK_CODE_TTL;
        $db->run('DELETE FROM kiosk_codes WHERE expires_at<=? OR account_id=?', $clock, $me['id']);
        $db->run('INSERT INTO kiosk_codes (code,account_id,label,created_at,expires_at) VALUES (?,?,?,?,?)', codeDigest($code), $me['id'], $label, $clock, $expires);
        audit($db, $me, 'confidentialite', 'Création d’un code d’activation de borne', $label ?: 'Borne', null, null);
        return ['code' => $code, 'label' => $label, 'expires_at' => $expires];
    }
    if ($path === '/api/gestion/borne/code' && $method === 'DELETE') {
        $db->run('DELETE FROM kiosk_codes WHERE account_id=?', $me['id']);
        return ['ok' => true];
    }
    $token = $_COOKIE['cdi_device'] ?? '';
    $current = is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token) ? substr(hash('sha256', $token), 0, 16) : '';
    if ($path === '/api/gestion/borne/postes' && $method === 'GET') {
        $sql = 'SELECT substr(k.token,1,16) AS id,k.label,k.created_at,k.last_seen,k.expires_at,k.agent,k.address,a.name AS activated_by,k.account_id
            FROM kiosk_devices k JOIN accounts a ON a.id=k.account_id WHERE k.expires_at>?' . ($me['admin'] ? '' : ' AND k.account_id=?')
            . ' ORDER BY k.last_seen DESC,k.created_at DESC';
        $rows = $me['admin'] ? $db->all($sql, $clock) : $db->all($sql, $clock, $me['id']);
        return ['settings' => deviceSettings($db), 'rows' => array_map(static function (array $row) use ($current, $me): array {
            $own = $row['account_id'] === $me['id'];
            unset($row['account_id']);
            return $row + ['current' => $row['id'] === $current, 'own' => $own];
        }, $rows)];
    }
    if ($path === '/api/gestion/borne/postes' && $method === 'PATCH') {
        if (!$me['admin']) {
            fail(403, 'Seul un administrateur peut modifier la durée d’activation des postes.');
        }
        $data = requestData();
        if (!is_string($data['duration'] ?? null) || !array_key_exists($data['duration'], DEVICE_DURATIONS) || !is_bool($data['renew'] ?? null)) {
            fail(400, 'Choisissez une durée d’activation valide.');
        }
        $before = deviceSettings($db);
        $nameSearch = is_bool($data['name_search'] ?? null) ? $data['name_search'] : $before['name_search'];
        $db->run('INSERT INTO kiosk_device_settings (id,duration,renew,name_search) VALUES (1,?,?,?)
            ON CONFLICT(id) DO UPDATE SET duration=excluded.duration,renew=excluded.renew,name_search=excluded.name_search',
            $data['duration'], (int) $data['renew'], (int) $nameSearch);
        audit($db, $me, 'confidentialite', 'Modification des réglages des postes de borne', 'Borne', $before,
            ['duration' => $data['duration'], 'renew' => $data['renew'], 'name_search' => $nameSearch]);
        return deviceSettings($db);
    }
    if (preg_match('~^/api/gestion/borne/postes/([a-f0-9]{16})$~D', $path, $match) && $method === 'DELETE') {
        $device = $db->one('SELECT token,account_id,label FROM kiosk_devices WHERE substr(token,1,16)=?', $match[1]);
        if (!$device || (!$me['admin'] && $device['account_id'] !== $me['id'])) {
            fail(404, 'Poste introuvable ou déjà révoqué.');
        }
        $db->run('DELETE FROM kiosk_devices WHERE token=?', $device['token']);
        audit($db, $me, 'confidentialite', 'Révocation d’un poste', $device['label'] ?: 'Borne', null, null);
        return ['ok' => true];
    }
    fail(404, 'Action introuvable.');
}

/** Score d’un élève pour la recherche de la borne (plus petit = meilleur), ou null. Même règle que cdi/devices.mjs. */
function matchScore(array $row, array $tokens, bool $fuzzy): ?int
{
    $names = explode(' ', $row['search_name']);
    $group = preg_replace('/\s+/u', '', (string) ($row['class_key'] ?? '')) ?? '';
    $score = 0;
    foreach ($tokens as $token) {
        $best = PHP_INT_MAX;
        $length = mb_strlen($token, 'UTF-8');
        foreach ($names as $name) {
            if ($name === $token) {
                $best = min($best, 0);
            } elseif (str_starts_with($name, $token)) {
                $best = min($best, 1);
            } elseif ($length >= 3 && str_contains($name, $token)) {
                $best = min($best, 4);
            } elseif ($fuzzy && $length >= 3) {
                $allowed = $length <= 4 ? 1 : 2;
                $gap = min(levenshtein($token, $name), levenshtein($token, mb_substr($name, 0, $length, 'UTF-8')) + 1);
                if ($gap <= $allowed) {
                    $best = min($best, 6 + $gap);
                }
            }
        }
        if ($group !== '' && ($group === $token || (mb_strlen($token, 'UTF-8') >= 2 && str_starts_with($group, $token)))) {
            $best = min($best, 2);
        }
        if ($best === PHP_INT_MAX) {
            return null;
        }
        $score += $best;
    }
    return $score;
}

function rankMatches(array $rows, array $tokens, bool $fuzzy): array
{
    $scored = [];
    foreach ($rows as $row) {
        $score = matchScore($row, $tokens, $fuzzy);
        if ($score !== null) {
            $scored[] = [$score, $row];
        }
    }
    usort($scored, static fn ($a, $b) => [$a[0], $a[1]['last_name'], $a[1]['first_name']] <=> [$b[0], $b[1]['last_name'], $b[1]['first_name']]);
    return array_column($scored, 1);
}

/** Recherche par nom sur la borne : 2 lettres, mots dans n’importe quel ordre, classe possible, fautes tolérées en dernier recours. */
function kioskSearch(Store $db, string $device, mixed $query, int $clock): array
{
    if (!deviceSettings($db)['name_search']) {
        fail(403, 'La recherche par nom est désactivée sur cette borne.');
    }
    throttle($db, 'search:' . $device, 40);
    $tokens = array_slice(array_values(array_filter(explode(' ', words($query)), static fn ($token) => $token !== '')), 0, 4);
    if (mb_strlen(implode('', $tokens), 'UTF-8') < 2) {
        return ['rows' => [], 'short' => true];
    }
    $columns = 'SELECT s.id,s.first_name,s.last_name,s.search_name,c.name AS class_name,c.normalized AS class_key FROM students s JOIN classes c ON c.id=s.class_id WHERE s.active=1 ';
    $params = [];
    foreach ($tokens as $token) {
        array_push($params, '%' . $token . '%', $token . '%');
    }
    $found = rankMatches($db->all($columns . str_repeat("AND (s.search_name LIKE ? OR replace(c.normalized,' ','') LIKE ?) ", count($tokens)) . 'LIMIT 200', ...$params), $tokens, false);
    $fuzzy = false;
    if (!$found && array_filter($tokens, static fn ($token) => mb_strlen($token, 'UTF-8') >= 3)) {
        $found = rankMatches($db->all($columns . 'LIMIT 5000'), $tokens, true);
        $fuzzy = (bool) $found;
    }
    $db->run('DELETE FROM kiosk_refs WHERE expires_at<=?', $clock);
    $rows = [];
    foreach (array_slice($found, 0, 6) as $row) {
        $ref = bin2hex(random_bytes(16));
        $db->run('INSERT INTO kiosk_refs VALUES (?,?,?,?)', $ref, $row['id'], $device, $clock + 180_000);
        $initial = mb_strtoupper(mb_substr(trim($row['last_name']), 0, 1, 'UTF-8'), 'UTF-8');
        $rows[] = ['ref' => $ref, 'label' => $row['first_name'] . ' ' . $initial . '.', 'class_name' => $row['class_name']];
    }
    return ['rows' => $rows, 'more' => count($found) > 6, 'fuzzy' => $fuzzy];
}

/** Code de carte reçu d’une douchette (clavier QWERTY sur poste AZERTY, préfixe AIM, casse) : même règle que la borne. */
function cardCode(mixed $value): string
{
    if (!is_string($value)) {
        return '';
    }
    $text = strtr(preg_replace('/\s+/u', '', mb_substr($value, 0, 80, 'UTF-8')) ?? '', ['&' => '1', 'é' => '2', 'É' => '2', '"' => '3', "'" => '4', '(' => '5',
        '-' => '6', '§' => '6', 'è' => '7', 'È' => '7', '_' => '8', '!' => '8', 'ç' => '9', 'Ç' => '9', 'à' => '0', 'À' => '0']);
    $text = strtoupper($text);
    $at = strpos($text, 'CDI');
    if ($at === false) {
        return '';
    }
    $body = str_replace('Q', 'A', substr($text, $at + 3, 10));
    return preg_match('/^[0-9A-F]{10}$/D', $body) ? 'CDI' . $body : '';
}

/** Affichage de la borne (v1.13) : réglages visuels validés. Même règle que cdi/display.mjs. */
const DISPLAY_DEFAULTS = ['show_places' => true, 'show_planning' => true, 'scan_animation' => true, 'confirm_seconds' => 4,
    'announcements' => [], 'rules' => ['Travail calme et respect de chacun', 'Ni nourriture ni boisson', 'Téléphone rangé'],
    'idle_enabled' => true, 'idle_delay' => 60, 'theme' => 'clair', 'dark_from' => 17, 'dark_to' => 8];

function displayText(mixed $value, int $limit): string
{
    return is_string($value) ? mb_substr(trim(preg_replace('/\s+/u', ' ', $value) ?? ''), 0, $limit, 'UTF-8') : '';
}

function checkDisplay(mixed $data): array
{
    if (!is_array($data) || array_is_list($data) && $data !== []) {
        fail(400, 'Les réglages d’affichage sont incomplets.');
    }
    $out = DISPLAY_DEFAULTS;
    foreach (['show_places', 'show_planning', 'scan_animation', 'idle_enabled'] as $key) {
        if (array_key_exists($key, $data)) {
            if (!is_bool($data[$key])) {
                fail(400, 'Les réglages d’affichage sont incomplets.');
            }
            $out[$key] = $data[$key];
        }
    }
    foreach ([['confirm_seconds', 2, 10, 'La confirmation dure de 2 à 10 secondes.'], ['idle_delay', 15, 900, 'L’écran de repos s’affiche après 15 secondes à 15 minutes.'],
        ['dark_from', 0, 23, 'Choisissez une heure de début du thème sombre.'], ['dark_to', 0, 23, 'Choisissez une heure de fin du thème sombre.']] as [$key, $min, $max, $message]) {
        if (array_key_exists($key, $data)) {
            if (!is_int($data[$key]) || $data[$key] < $min || $data[$key] > $max) {
                fail(400, $message);
            }
            $out[$key] = $data[$key];
        }
    }
    if (array_key_exists('theme', $data)) {
        if (!in_array($data['theme'], ['clair', 'sombre', 'horaire'], true)) {
            fail(400, 'Choisissez un thème.');
        }
        $out['theme'] = $data['theme'];
    }
    if (array_key_exists('announcements', $data)) {
        if (!is_array($data['announcements']) || count($data['announcements']) > 6) {
            fail(400, 'Six annonces au maximum.');
        }
        $out['announcements'] = [];
        foreach ($data['announcements'] as $item) {
            $text = displayText($item['text'] ?? null, 160);
            if ($text === '' || !in_array($item['tone'] ?? null, ['info', 'succes', 'attention', 'alerte', 'evenement'], true)) {
                fail(400, 'Chaque annonce a un texte (160 caractères au plus) et une couleur.');
            }
            $out['announcements'][] = ['text' => $text, 'tone' => $item['tone']];
        }
    }
    if (array_key_exists('rules', $data)) {
        if (!is_array($data['rules']) || count($data['rules']) > 6) {
            fail(400, 'Six règles au maximum.');
        }
        $out['rules'] = array_values(array_filter(array_map(static fn ($rule) => displayText($rule, 70), $data['rules']), static fn ($rule) => $rule !== ''));
    }
    return $out;
}

function displaySettings(Store $db): array
{
    $stored = json_decode((string) ($db->one('SELECT settings FROM kiosk_display WHERE id=1')['settings'] ?? '{}'), true);
    if (!is_array($stored)) {
        return DISPLAY_DEFAULTS;
    }
    try {
        return checkDisplay($stored);
    } catch (Throwable) {
        return DISPLAY_DEFAULTS;
    }
}

function changeDisplay(Store $db, array $me, array $data): array
{
    $before = displaySettings($db);
    $after = checkDisplay(array_merge($before, $data));
    $db->run('INSERT INTO kiosk_display (id,settings) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings', jsonData($after));
    audit($db, $me, 'horaires', 'Modification de l’affichage de la borne', 'Borne', $before, $after);
    return $after;
}

/** Planning du jour pour la borne : horaires d’ouverture et créneaux réservés ou fermés, sans nom de classe. */
function kioskToday(Store $db, int $clock): array
{
    $now = parisClock($clock);
    $useHours = ($db->one('SELECT use_hours FROM kiosk_settings WHERE id=1')['use_hours'] ?? 0) === 1;
    $rows = array_map(static function (array $row): array {
        $closed = $row['kind'] === 'fermeture';
        $refused = !$closed && (int) $row['students_allowed'] === 0;
        return ['start_min' => (int) $row['start_min'], 'end_min' => (int) $row['end_min'], 'kind' => $closed || $refused ? 'fermeture' : 'reservation',
            'title' => $closed ? 'Fermé' : ($refused ? 'Réservé · fermé aux élèves' : 'Réservé')];
    }, $db->all('SELECT start_min,end_min,kind,students_allowed FROM planning WHERE day=? ORDER BY start_min', $now['day']));
    return ['day' => $now['day'], 'minute' => $now['minute'],
        'hours' => $useHours ? $db->all('SELECT start_min,end_min FROM opening_hours WHERE weekday=? ORDER BY start_min', $now['weekday']) : [],
        'rows' => $rows];
}

