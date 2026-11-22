<?php
declare(strict_types=1);

// Sécurité des comptes : double authentification TOTP, codes de secours, sessions actives.
// Logique identique à cdi/security.mjs (édition Docker).

const TOTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function base32Encode(string $bytes): string
{
    $bits = 0;
    $value = 0;
    $out = '';
    foreach (str_split($bytes) as $char) {
        $value = (($value << 8) | ord($char)) & 0xffff;
        $bits += 8;
        while ($bits >= 5) {
            $out .= TOTP_ALPHABET[($value >> ($bits - 5)) & 31];
            $bits -= 5;
        }
    }
    if ($bits > 0) {
        $out .= TOTP_ALPHABET[($value << (5 - $bits)) & 31];
    }
    return $out;
}

function base32Decode(string $text): string
{
    $bits = 0;
    $value = 0;
    $out = '';
    foreach (str_split($text) as $char) {
        $index = strpos(TOTP_ALPHABET, $char);
        if ($index === false) {
            throw new RuntimeException('Secret TOTP invalide');
        }
        $value = (($value << 5) | $index) & 0xffff;
        $bits += 5;
        if ($bits >= 8) {
            $out .= chr(($value >> ($bits - 8)) & 255);
            $bits -= 8;
        }
    }
    return $out;
}

function totpCode(string $secret, int $step): string
{
    $hmac = hash_hmac('sha1', pack('J', $step), base32Decode($secret), true);
    $offset = ord($hmac[19]) & 15;
    $code = ((ord($hmac[$offset]) & 127) << 24 | ord($hmac[$offset + 1]) << 16 | ord($hmac[$offset + 2]) << 8 | ord($hmac[$offset + 3])) % 1_000_000;
    return str_pad((string) $code, 6, '0', STR_PAD_LEFT);
}

function matchTotp(string $secret, string $code, int $lastStep, int $clock): int
{
    $now = intdiv($clock, 30_000);
    $found = 0;
    foreach ([$now - 1, $now, $now + 1] as $step) {
        if ($step > $lastStep && hash_equals(totpCode($secret, $step), $code)) {
            $found = $step;
        }
    }
    return $found;
}

function normalizeCode(mixed $value): string
{
    return is_string($value) ? substr((string) preg_replace('/[\s-]/', '', strtolower($value)), 0, 20) : '';
}

/** @return array{codes: list<string>, hashes: string} */
function recoveryCodes(): array
{
    $codes = [];
    while (count($codes) < 10) {
        $code = '';
        while (strlen($code) < 8) {
            $byte = ord(random_bytes(1));
            if ($byte < 248) {
                $code .= RECOVERY_ALPHABET[$byte % 31];
            }
        }
        $codes[] = substr($code, 0, 4) . '-' . substr($code, 4);
    }
    return ['codes' => $codes, 'hashes' => jsonData(array_map(static fn ($code) => hash('sha256', normalizeCode($code)), $codes))];
}

function agentSummary(string $agent): string
{
    $browser = match (true) {
        str_contains($agent, 'Edg/') => 'Edge', str_contains($agent, 'OPR/') => 'Opera',
        str_contains($agent, 'Firefox/') => 'Firefox', str_contains($agent, 'Chrome/') => 'Chrome',
        str_contains($agent, 'Safari/') => 'Safari', default => '',
    };
    $system = match (true) {
        str_contains($agent, 'Windows') => 'Windows', str_contains($agent, 'Android') => 'Android',
        (bool) preg_match('/iPhone|iPad/', $agent) => 'iOS', str_contains($agent, 'Mac OS X') => 'macOS',
        str_contains($agent, 'CrOS') => 'ChromeOS', str_contains($agent, 'Linux') => 'Linux', default => '',
    };
    return implode(' · ', array_filter([$browser, $system])) ?: 'Navigateur inconnu';
}

function loginTrace(): array
{
    return ['poste' => clientAddress(), 'navigateur' => agentSummary((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))];
}

/** Vérifie puis consomme un code TOTP ou de secours. Retourne 'totp', 'secours' ou ''. */
function consumeSecondFactor(Store $db, string $accountId, array $mfa, mixed $input, int $clock): string
{
    $code = normalizeCode($input);
    if (preg_match('/^\d{6}$/D', $code)) {
        $step = matchTotp($mfa['secret'], $code, (int) $mfa['last_step'], $clock);
        return $step && $db->run('UPDATE account_mfa SET last_step=? WHERE account_id=? AND last_step<?', $step, $accountId, $step) ? 'totp' : '';
    }
    if (!preg_match('/^[a-z0-9]{8}$/D', $code)) {
        return '';
    }
    $hash = hash('sha256', $code);
    $list = json_decode($mfa['recovery'] ?: '[]', true);
    if (!in_array($hash, $list, true)) {
        return '';
    }
    $rest = jsonData(array_values(array_filter($list, static fn ($item) => $item !== $hash)));
    return $db->run('UPDATE account_mfa SET recovery=? WHERE account_id=? AND recovery=?', $rest, $accountId, $mfa['recovery']) ? 'secours' : '';
}

function currentSessionId(): string
{
    $token = sessionToken();
    return $token === null ? '' : substr(hash('sha256', $token), 0, 16);
}

const SESSION_COLUMNS = 'substr(t.token,1,16) AS id,t.created_at,t.last_seen,t.agent,t.address,t.expires_at';

function securityResource(Store $db, string $path, string $method, array $me, int $clock): ?array
{
    $current = currentSessionId();
    $mfaRow = static fn (string $id): ?array => $db->one('SELECT * FROM account_mfa WHERE account_id=?', $id);
    $checkPassword = static function (mixed $password) use ($db, $me): void {
        $account = $db->one('SELECT secret FROM accounts WHERE id=?', $me['id']);
        $value = is_string($password) ? mb_substr($password, 0, 161, 'UTF-8') : '';
        if (!verifyPassword($value, $account['secret'] ?? null)['ok']) {
            fail(403, 'Mot de passe actuel incorrect.');
        }
    };

    if ($path === '/api/gestion/securite' && $method === 'GET') {
        $mfa = $mfaRow($me['id']);
        $sessions = $db->all('SELECT ' . SESSION_COLUMNS . ' FROM sessions t WHERE t.account_id=? AND t.expires_at>? ORDER BY t.last_seen DESC', $me['id'], $clock);
        $enabled = $mfa !== null && $mfa['secret'] !== null;
        return [
            'mfa' => ['enabled' => $enabled, 'recovery_left' => $enabled ? count(json_decode($mfa['recovery'], true)) : 0, 'enabled_at' => $mfa['enabled_at'] ?? null],
            'sessions' => array_map(static fn ($row) => $row + ['current' => $row['id'] === $current], $sessions),
        ];
    }
    if ($path === '/api/gestion/securite/totp' && $method === 'POST') {
        $data = requestData();
        $checkPassword($data['password'] ?? null);
        if (($mfaRow($me['id'])['secret'] ?? null) !== null) {
            fail(409, 'La double authentification est déjà active.');
        }
        $secret = base32Encode(random_bytes(20));
        $db->run('INSERT INTO account_mfa (account_id,pending) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET pending=excluded.pending', $me['id'], $secret);
        return ['secret' => $secret, 'uri' => 'otpauth://totp/' . rawurlencode('TiceCDI:' . $me['username']) . "?secret=$secret&issuer=TiceCDI&algorithm=SHA1&digits=6&period=30"];
    }
    if ($path === '/api/gestion/securite/totp/activation' && $method === 'POST') {
        $data = requestData();
        $mfa = $mfaRow($me['id']);
        if (!$mfa || $mfa['pending'] === null || $mfa['secret'] !== null) {
            fail(409, 'Recommencez l’activation de la double authentification.');
        }
        $step = matchTotp($mfa['pending'], normalizeCode($data['code'] ?? null), 0, $clock);
        if (!$step) {
            fail(400, 'Code incorrect. Vérifiez l’heure du téléphone et saisissez le code affiché.');
        }
        $recovery = recoveryCodes();
        $db->run('UPDATE account_mfa SET secret=pending,pending=NULL,last_step=?,recovery=?,enabled_at=? WHERE account_id=? AND secret IS NULL', $step, $recovery['hashes'], $clock, $me['id']);
        $db->run('DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)<>?', $me['id'], $current);
        audit($db, $me, 'securite', 'Activation de la double authentification', $me['username'], null, null);
        return ['codes' => $recovery['codes']];
    }
    if ($path === '/api/gestion/securite/totp/desactivation' && $method === 'POST') {
        $data = requestData();
        $checkPassword($data['password'] ?? null);
        $mfa = $mfaRow($me['id']);
        if (!$mfa || $mfa['secret'] === null) {
            fail(409, 'La double authentification n’est pas active.');
        }
        if (consumeSecondFactor($db, $me['id'], $mfa, $data['code'] ?? null, $clock) === '') {
            fail(403, 'Code de vérification incorrect.');
        }
        $db->run('DELETE FROM account_mfa WHERE account_id=?', $me['id']);
        audit($db, $me, 'securite', 'Désactivation de la double authentification', $me['username'], null, null);
        return ['ok' => true];
    }
    if ($path === '/api/gestion/securite/codes' && $method === 'POST') {
        $data = requestData();
        $checkPassword($data['password'] ?? null);
        if (($mfaRow($me['id'])['secret'] ?? null) === null) {
            fail(409, 'La double authentification n’est pas active.');
        }
        $recovery = recoveryCodes();
        $db->run('UPDATE account_mfa SET recovery=? WHERE account_id=?', $recovery['hashes'], $me['id']);
        audit($db, $me, 'securite', 'Nouveaux codes de secours', $me['username'], null, null);
        return ['codes' => $recovery['codes']];
    }
    if (preg_match('~^/api/gestion/securite/sessions(?:/([a-f0-9]{16}))?$~D', $path, $own) && $method === 'DELETE') {
        $target = $own[1] ?? '';
        $removed = $target !== ''
            ? $db->run('DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)=?', $me['id'], $target)
            : $db->run('DELETE FROM sessions WHERE account_id=? AND substr(token,1,16)<>?', $me['id'], $current);
        if ($target !== '' && !$removed) {
            fail(404, 'Session introuvable ou déjà fermée.');
        }
        if ($removed) {
            audit($db, $me, 'securite', $target !== '' ? 'Fermeture d’une session' : 'Fermeture des autres sessions', $me['username'], null, null);
        }
        if ($target !== '' && $target === $current) {
            cookie('', 1);
        }
        return ['ok' => true];
    }
    if ($path === '/api/gestion/sessions' && $method === 'GET') {
        adminOnly($me);
        $rows = $db->all('SELECT ' . SESSION_COLUMNS . ',a.name,a.username,
            EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS mfa
            FROM sessions t JOIN accounts a ON a.id=t.account_id WHERE t.expires_at>? ORDER BY t.last_seen DESC LIMIT 500', $clock);
        return ['rows' => array_map(static fn ($row) => ['mfa' => (bool) $row['mfa'], 'current' => $row['id'] === $current] + $row, $rows)];
    }
    if (preg_match('~^/api/gestion/sessions/([a-f0-9]{16})$~D', $path, $any) && $method === 'DELETE') {
        adminOnly($me);
        $owner = $db->one('SELECT a.username FROM sessions t JOIN accounts a ON a.id=t.account_id WHERE substr(t.token,1,16)=?', $any[1]);
        if (!$owner) {
            fail(404, 'Session introuvable ou déjà fermée.');
        }
        $db->run('DELETE FROM sessions WHERE substr(token,1,16)=?', $any[1]);
        audit($db, $me, 'securite', 'Fermeture d’une session par un administrateur', $owner['username'], null, null);
        if ($any[1] === $current) {
            cookie('', 1);
        }
        return ['ok' => true];
    }
    if (preg_match('~^/api/gestion/comptes/([a-f0-9-]+)/double-authentification$~D', $path, $reset) && $method === 'DELETE') {
        if (!$me['admin']) {
            fail(403, 'Seul un administrateur peut réinitialiser la double authentification.');
        }
        $target = $db->one('SELECT id,username FROM accounts WHERE id=?', $reset[1]);
        if (!$target) {
            fail(404, 'Compte introuvable.');
        }
        if ($target['id'] === $me['id']) {
            fail(409, 'Désactivez votre double authentification depuis « Sécurité du compte ».');
        }
        if (!$db->run('DELETE FROM account_mfa WHERE account_id=?', $target['id'])) {
            fail(409, 'Ce compte n’utilise pas la double authentification.');
        }
        $db->run('DELETE FROM sessions WHERE account_id=?', $target['id']);
        audit($db, $me, 'securite', 'Réinitialisation de la double authentification', $target['username'], null, null);
        return ['ok' => true];
    }
    return null;
}
