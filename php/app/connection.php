<?php
declare(strict_types=1);

// Réglages de connexion : double authentification exigée, inactivité, alertes et connexion ENT (CAS ou OpenID Connect).
// Logique identique à cdi/connection.mjs (édition Docker).

const FAILURE_ACTIONS = ['Échec de connexion', 'Échec de la double authentification', 'Échec de connexion ENT'];

function connectionSettings(Store $db): array
{
    return $db->one('SELECT * FROM security_settings WHERE id=1') ?? [
        'mfa_policy' => 'none', 'idle_minutes' => 0, 'alert_threshold' => 5, 'sso_mode' => '', 'sso_label' => 'ENT', 'cas_url' => '',
        'oidc_issuer' => '', 'oidc_client_id' => '', 'oidc_client_secret' => '', 'oidc_claim' => 'preferred_username',
    ];
}

function ssoPublic(array $settings): array
{
    return ['enabled' => $settings['sso_mode'] !== '', 'label' => $settings['sso_label'] ?: 'ENT'];
}

function publicOrigin(): string
{
    $configured = setting('CDI_ORIGIN');
    if ($configured !== '') {
        return rtrim($configured, '/');
    }
    $host = preg_match('/^[a-z0-9.:\[\]-]+$/i', $_SERVER['HTTP_HOST'] ?? '') ? $_SERVER['HTTP_HOST'] : 'localhost';
    return (isHttps() ? 'https://' : 'http://') . $host;
}

function ssoCallbackUrl(string $state = ''): string
{
    return publicOrigin() . entryPath() . '?route=%2Fapi%2Fauth%2Fsso%2Fcallback' . ($state !== '' ? '&state=' . $state : '');
}

function pageUrl(string $route, array $query = []): string
{
    return entryPath() . '?' . http_build_query(['route' => $route] + $query);
}

function safeUrl(string $value, string $field): string
{
    if ($value === '') {
        return '';
    }
    $url = parse_url($value);
    $host = strtolower($url['host'] ?? '');
    $local = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true);
    $scheme = $url['scheme'] ?? '';
    if (!$url || $host === '' || isset($url['user']) || isset($url['pass']) || isset($url['fragment'])) {
        fail(400, "$field : adresse invalide.");
    }
    if ($scheme !== 'https' && !($local && $scheme === 'http')) {
        fail(400, "$field : utilisez une adresse en https://.");
    }
    return rtrim($value, '/');
}

/** @return array{status: int, body: string} */
function outbound(string $url, string $method = 'GET', ?string $body = null, array $headers = []): array
{
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        if ($body !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        if ($response === false) {
            throw new RuntimeException('Fournisseur injoignable');
        }
        return ['status' => $status, 'body' => substr((string) $response, 0, 1_000_000)];
    }
    $context = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '', 'timeout' => 8,
        'follow_location' => 0, 'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($url, false, $context, 0, 1_000_000);
    if ($response === false) {
        throw new RuntimeException('Fournisseur injoignable');
    }
    $status = preg_match('~^HTTP/\S+\s+(\d{3})~', $http_response_header[0] ?? '', $match) ? (int) $match[1] : 0;
    return ['status' => $status, 'body' => $response];
}

function oidcDiscovery(string $issuer): array
{
    $result = outbound($issuer . '/.well-known/openid-configuration', 'GET', null, ['Accept: application/json']);
    $config = json_decode($result['body'], true);
    if ($result['status'] !== 200 || !is_array($config) || empty($config['authorization_endpoint']) || empty($config['token_endpoint']) || empty($config['issuer'])) {
        throw new RuntimeException('Configuration OpenID Connect incomplète');
    }
    return $config;
}

function base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function settingsView(array $settings, ?string $callback): array
{
    unset($settings['oidc_client_secret'], $settings['id']);
    $view = $settings + ['has_secret' => false];
    return $callback === null ? $view : $view + ['callback' => $callback];
}

function connectionResource(Store $db, string $path, string $method, array $me, int $clock): ?array
{
    if ($path === '/api/gestion/securite/alertes' && $method === 'GET') {
        if (!$me['admin']) {
            return ['rows' => []];
        }
        $settings = connectionSettings($db);
        $rows = $db->all("SELECT target,count(*) AS count,max(at) AS last FROM audit_log
            WHERE area='securite' AND action IN (?,?,?) AND at>? GROUP BY target HAVING count(*)>=? ORDER BY count DESC LIMIT 20",
            ...[...FAILURE_ACTIONS, $clock - 86_400_000, (int) $settings['alert_threshold']]);
        return ['threshold' => (int) $settings['alert_threshold'], 'rows' => $rows];
    }
    if (!str_starts_with($path, '/api/gestion/connexion')) {
        return null;
    }
    adminOnly($me);
    $settings = connectionSettings($db);
    if ($path === '/api/gestion/connexion' && $method === 'GET') {
        return ['has_secret' => $settings['oidc_client_secret'] !== ''] + settingsView($settings, ssoCallbackUrl());
    }
    if ($path === '/api/gestion/connexion' && $method === 'PATCH') {
        $data = requestData();
        $text = static fn ($value, int $limit): string => is_string($value) ? mb_substr(trim($value), 0, $limit, 'UTF-8') : '';
        $policy = $data['mfa_policy'] ?? null;
        $idle = $data['idle_minutes'] ?? null;
        $threshold = $data['alert_threshold'] ?? null;
        $mode = $data['sso_mode'] ?? null;
        if (!in_array($policy, ['none', 'admins', 'all'], true)) {
            fail(400, 'Choisissez une règle de double authentification.');
        }
        if (!is_int($idle) || $idle < 0 || $idle > 720) {
            fail(400, 'La durée d’inactivité doit être comprise entre 0 et 720 minutes.');
        }
        if (!is_int($threshold) || $threshold < 3 || $threshold > 100) {
            fail(400, 'Le seuil d’alerte doit être compris entre 3 et 100.');
        }
        if (!in_array($mode, ['', 'cas', 'oidc'], true)) {
            fail(400, 'Mode de connexion ENT inconnu.');
        }
        $claim = $text($data['oidc_claim'] ?? '', 60);
        $next = [
            'mfa_policy' => $policy, 'idle_minutes' => $idle, 'alert_threshold' => $threshold, 'sso_mode' => $mode,
            'sso_label' => $text($data['sso_label'] ?? '', 40) ?: 'ENT',
            'cas_url' => safeUrl($text($data['cas_url'] ?? '', 300), 'Adresse CAS'),
            'oidc_issuer' => safeUrl($text($data['oidc_issuer'] ?? '', 300), 'Émetteur OpenID Connect'),
            'oidc_client_id' => $text($data['oidc_client_id'] ?? '', 200),
            'oidc_client_secret' => is_string($data['oidc_client_secret'] ?? null) && $data['oidc_client_secret'] !== ''
                ? mb_substr($data['oidc_client_secret'], 0, 500, 'UTF-8') : $settings['oidc_client_secret'],
            'oidc_claim' => preg_match('/^[a-zA-Z0-9_:.-]{1,60}$/D', $claim) ? $claim : 'preferred_username',
        ];
        if (($data['clear_secret'] ?? false) === true) {
            $next['oidc_client_secret'] = '';
        }
        if ($mode === 'cas' && $next['cas_url'] === '') {
            fail(400, 'Renseignez l’adresse du serveur CAS de l’ENT.');
        }
        if ($mode === 'oidc' && ($next['oidc_issuer'] === '' || $next['oidc_client_id'] === '')) {
            fail(400, 'Renseignez l’émetteur et l’identifiant client OpenID Connect.');
        }
        $db->run('UPDATE security_settings SET mfa_policy=?,idle_minutes=?,alert_threshold=?,sso_mode=?,sso_label=?,cas_url=?,oidc_issuer=?,oidc_client_id=?,oidc_client_secret=?,oidc_claim=? WHERE id=1',
            $next['mfa_policy'], $next['idle_minutes'], $next['alert_threshold'], $next['sso_mode'], $next['sso_label'], $next['cas_url'],
            $next['oidc_issuer'], $next['oidc_client_id'], $next['oidc_client_secret'], $next['oidc_claim']);
        audit($db, $me, 'securite', 'Modification des réglages de connexion', 'Connexion et sécurité',
            ['has_secret' => $settings['oidc_client_secret'] !== ''] + settingsView($settings, null),
            ['has_secret' => $next['oidc_client_secret'] !== ''] + settingsView($next, null));
        return ['ok' => true];
    }
    if ($path === '/api/gestion/connexion/test' && $method === 'POST') {
        try {
            if ($settings['sso_mode'] === 'oidc') {
                $config = oidcDiscovery($settings['oidc_issuer']);
                return ['ok' => true, 'message' => 'Fournisseur joignable : ' . $config['issuer']];
            }
            if ($settings['sso_mode'] === 'cas') {
                $result = outbound($settings['cas_url'] . '/login');
                return ['ok' => $result['status'] > 0 && $result['status'] < 500, 'message' => 'Serveur CAS joignable (HTTP ' . $result['status'] . ').'];
            }
            return ['ok' => false, 'message' => 'La connexion ENT est désactivée.'];
        } catch (Throwable $error) {
            return ['ok' => false, 'message' => 'Fournisseur injoignable : ' . $error->getMessage() . '.'];
        }
    }
    fail(404, 'Action introuvable.');
}

function redirectTo(string $location): never
{
    http_response_code(303);
    header('Location: ' . $location);
    header('Cache-Control: no-store');
    exit;
}

function ssoFailure(Store $db, string $reason, string $who = 'Identifiant ENT inconnu'): never
{
    audit($db, ['name' => $who], 'securite', 'Échec de connexion ENT', $reason, null, loginTrace());
    cookie('', 1, 'cdi_sso', 'Lax');
    redirectTo(pageUrl('/connexion', ['sso' => 'echec']));
}

function ssoResource(Store $db, string $path, string $method, int $clock): void
{
    $settings = connectionSettings($db);
    if ($path === '/api/auth/sso/start' && $method === 'GET') {
        if ($settings['sso_mode'] === '') {
            fail(404, 'La connexion ENT est désactivée.');
        }
        $state = bin2hex(random_bytes(16));
        $nonce = bin2hex(random_bytes(16));
        $verifier = bin2hex(random_bytes(32));
        $db->run('DELETE FROM sso_states WHERE expires_at<=?', $clock);
        $db->run('INSERT INTO sso_states VALUES (?,?,?,?)', $state, $nonce, $verifier, $clock + 600_000);
        if ($settings['sso_mode'] === 'cas') {
            $target = $settings['cas_url'] . '/login?service=' . rawurlencode(ssoCallbackUrl($state));
        } else {
            try {
                $config = oidcDiscovery($settings['oidc_issuer']);
            } catch (Throwable) {
                fail(502, 'Le fournisseur d’identité ne répond pas.');
            }
            $query = http_build_query([
                'response_type' => 'code', 'client_id' => $settings['oidc_client_id'], 'redirect_uri' => ssoCallbackUrl(),
                'scope' => 'openid profile email', 'state' => $state, 'nonce' => $nonce,
                'code_challenge' => base64url(hash('sha256', $verifier, true)), 'code_challenge_method' => 'S256',
            ], '', '&', PHP_QUERY_RFC3986);
            $target = $config['authorization_endpoint'] . (str_contains($config['authorization_endpoint'], '?') ? '&' : '?') . $query;
        }
        cookie($state, intdiv($clock, 1000) + 600, 'cdi_sso', 'Lax');
        redirectTo($target);
    }
    if ($path !== '/api/auth/sso/callback' || $method !== 'GET') {
        fail(404, 'Action introuvable.');
    }
    $state = q('state');
    $bound = $_COOKIE['cdi_sso'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/D', $state) || !is_string($bound) || !hash_equals($state, $bound)) {
        ssoFailure($db, 'Retour ENT non reconnu');
    }
    $saved = $db->one('SELECT * FROM sso_states WHERE state=? AND expires_at>?', $state, $clock);
    $db->run('DELETE FROM sso_states WHERE state=?', $state);
    if (!$saved || $settings['sso_mode'] === '') {
        ssoFailure($db, 'Retour ENT expiré');
    }
    try {
        if ($settings['sso_mode'] === 'cas') {
            $ticket = q('ticket');
            if (!preg_match('/^[\w.-]{1,256}$/D', $ticket)) {
                ssoFailure($db, 'Ticket CAS absent');
            }
            $result = outbound($settings['cas_url'] . '/serviceValidate?service=' . rawurlencode(ssoCallbackUrl($state)) . '&ticket=' . rawurlencode($ticket));
            if (!str_contains($result['body'], '<cas:authenticationSuccess>')) {
                ssoFailure($db, 'Ticket CAS refusé');
            }
            $login = preg_match('~<cas:user>([^<]{1,200})</cas:user>~', $result['body'], $match) ? html_entity_decode(trim($match[1]), ENT_QUOTES | ENT_XML1, 'UTF-8') : '';
        } else {
            $code = q('code');
            if ($code === '' || strlen($code) > 2000) {
                ssoFailure($db, 'Code OpenID Connect absent');
            }
            $config = oidcDiscovery($settings['oidc_issuer']);
            $form = ['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => ssoCallbackUrl(),
                'client_id' => $settings['oidc_client_id'], 'code_verifier' => $saved['verifier']];
            if ($settings['oidc_client_secret'] !== '') {
                $form['client_secret'] = $settings['oidc_client_secret'];
            }
            $token = outbound($config['token_endpoint'], 'POST', http_build_query($form, '', '&', PHP_QUERY_RFC3986),
                ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json']);
            $tokens = json_decode($token['body'], true);
            if ($token['status'] !== 200 || !is_array($tokens) || !is_string($tokens['id_token'] ?? null)) {
                ssoFailure($db, 'Jeton OpenID Connect refusé');
            }
            // Jeton reçu directement du fournisseur en TLS : émetteur, audience, expiration et nonce contrôlés (OIDC Core 3.1.3.7).
            $parts = explode('.', $tokens['id_token']);
            $claims = json_decode((string) base64_decode(strtr($parts[1] ?? '', '-_', '+/')), true);
            $audience = is_array($claims['aud'] ?? null) ? $claims['aud'] : [$claims['aud'] ?? null];
            if (!is_array($claims) || ($claims['iss'] ?? null) !== $config['issuer'] || !in_array($settings['oidc_client_id'], $audience, true)
                || !is_numeric($claims['exp'] ?? null) || $claims['exp'] * 1000 <= $clock || ($claims['nonce'] ?? null) !== $saved['nonce']) {
                ssoFailure($db, 'Jeton OpenID Connect invalide');
            }
            $value = $claims[$settings['oidc_claim']] ?? null;
            if ($value === null && !empty($config['userinfo_endpoint']) && is_string($tokens['access_token'] ?? null)) {
                $info = outbound($config['userinfo_endpoint'], 'GET', null, ['Authorization: Bearer ' . $tokens['access_token'], 'Accept: application/json']);
                $value = json_decode($info['body'], true)[$settings['oidc_claim']] ?? null;
            }
            $login = is_string($value) ? $value : '';
        }
    } catch (Throwable) {
        ssoFailure($db, 'Fournisseur d’identité injoignable');
    }
    $login = strtolower(trim($login));
    $account = preg_match('/^[a-z0-9][a-z0-9_.@-]{2,79}$/D', $login) ? $db->one('SELECT * FROM accounts WHERE username=?', $login) : null;
    if (!$account) {
        ssoFailure($db, 'Aucun compte TiceCDI pour « ' . mb_substr($login, 0, 80, 'UTF-8') . ' »');
    }
    cookie('', 1, 'cdi_sso', 'Lax');
    if ($db->one('SELECT 1 FROM account_mfa WHERE account_id=? AND secret IS NOT NULL', $account['id'])) {
        $challenge = bin2hex(random_bytes(32));
        $db->run('DELETE FROM login_challenges WHERE expires_at<=?', $clock);
        $db->run('INSERT INTO login_challenges VALUES (?,?,?)', hash('sha256', $challenge), $account['id'], $clock + 300_000);
        cookie($challenge, intdiv($clock, 1000) + 300, 'cdi_challenge');
        redirectTo(pageUrl('/connexion', ['etape' => 'code']));
    }
    startLogin($db, $account['id'], $clock);
    redirectTo(pageUrl('/gestion'));
}

function challengeLogin(Store $db, int $clock): array
{
    $token = $_COOKIE['cdi_challenge'] ?? '';
    $pending = is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token)
        ? $db->one('SELECT * FROM login_challenges WHERE token=? AND expires_at>?', hash('sha256', $token), $clock) : null;
    if (!$pending) {
        fail(401, 'La vérification a expiré. Reconnectez-vous.');
    }
    $account = $db->one('SELECT * FROM accounts WHERE id=?', $pending['account_id']);
    $mfa = $db->one('SELECT * FROM account_mfa WHERE account_id=? AND secret IS NOT NULL', $pending['account_id']);
    $data = requestData();
    throttle($db, 'mfa:' . $account['id'], 6, 10);
    if (!$mfa || consumeSecondFactor($db, $account['id'], $mfa, $data['code'] ?? null, $clock) === '') {
        audit($db, $account, 'securite', 'Échec de la double authentification', $account['username'], null, loginTrace());
        fail(401, 'Code de vérification incorrect.');
    }
    $db->run('DELETE FROM login_challenges WHERE token=?', $pending['token']);
    cookie('', 1, 'cdi_challenge');
    return startLogin($db, $account['id'], $clock);
}
