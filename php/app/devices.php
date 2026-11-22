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
    $row = $db->one('SELECT duration,renew FROM kiosk_device_settings WHERE id=1');
    return ['duration' => $row['duration'] ?? '30j', 'renew' => $row ? (int) $row['renew'] === 1 : true];
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

function devicesResource(Store $db, string $path, string $method, array $me, int $clock): ?array
{
    if (!str_starts_with($path, '/api/gestion/borne/postes')) {
        return null;
    }
    need($me, 'borne');
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
        $db->run('INSERT INTO kiosk_device_settings (id,duration,renew) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET duration=excluded.duration,renew=excluded.renew',
            $data['duration'], (int) $data['renew']);
        audit($db, $me, 'confidentialite', 'Modification de la durée d’activation des postes', 'Borne', $before, ['duration' => $data['duration'], 'renew' => $data['renew']]);
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
