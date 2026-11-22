<?php
declare(strict_types=1);

// Droits : « gérer » (clé simple) ou « consulter » (suffixe _voir) par rubrique, plus des actions ponctuelles.
const RIGHTS = [
    'presence', 'sorties', 'exclusions', 'exclusions_voir', 'eleves', 'eleves_voir', 'classes', 'classes_voir', 'import', 'badges',
    'comptes', 'arrivees', 'seances_voir', 'planning', 'planning_voir', 'statistiques', 'groupes', 'groupes_voir', 'borne',
    'reglages', 'reglages_voir', 'journal', 'export', 'restaurer', 'donnees',
];
const HOUR_MS = 3_600_000;
const MAX_BACKUP_BYTES = 14_000_000;
const SCHEDULE_KINDS = ['cours', 'atelier', 'reservation', 'fermeture', 'autre'];

final class RequestError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function fail(int $status, string $message): never
{
    throw new RequestError($status, $message);
}

final class Store
{
    private PDO $pdo;

    public function __construct(string $dataDir, string $migrations)
    {
        $this->pdo = new PDO('sqlite:' . $dataDir . '/cdi.sqlite', options: [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $version = (string) $this->pdo->query('SELECT sqlite_version()')->fetchColumn();
        if (version_compare($version, '3.38.0', '<')) {
            throw new RuntimeException('SQLite 3.38 ou supérieur requis');
        }
        $this->pdo->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
        $applied = array_column($this->all('SELECT name FROM local_migrations'), 'name');
        foreach (glob($migrations . '/*.sql') ?: [] as $file) {
            $name = basename($file);
            if (in_array($name, $applied, true)) {
                continue;
            }
            $this->atomic(function () use ($file, $name): void {
                if (!$this->one('SELECT name FROM local_migrations WHERE name=?', $name)) {
                    $sql = file_get_contents($file);
                    if ($sql === false) {
                        throw new RuntimeException('Migration illisible');
                    }
                    $this->pdo->exec($sql);
                    $this->run('INSERT INTO local_migrations (name) VALUES (?)', $name);
                }
            });
        }
    }

    private function query(string $sql, array $values): PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        foreach (array_values($values) as $i => $value) {
            $type = match (true) {
                $value === null => PDO::PARAM_NULL,
                is_bool($value), is_int($value) => PDO::PARAM_INT,
                default => PDO::PARAM_STR,
            };
            $stmt->bindValue($i + 1, $value, $type);
        }
        $stmt->execute();
        return $stmt;
    }

    public function one(string $sql, mixed ...$values): ?array
    {
        return $this->query($sql, $values)->fetch() ?: null;
    }

    public function all(string $sql, mixed ...$values): array
    {
        return $this->query($sql, $values)->fetchAll();
    }

    public function run(string $sql, mixed ...$values): int
    {
        return $this->query($sql, $values)->rowCount();
    }

    public function atomic(callable $operation, bool $write = true): mixed
    {
        $this->pdo->exec($write ? 'BEGIN IMMEDIATE' : 'BEGIN');
        try {
            $result = $operation();
            $this->pdo->exec('COMMIT');
            return $result;
        } catch (Throwable $error) {
            $this->pdo->exec('ROLLBACK');
            throw $error;
        }
    }
}

function jsonData(mixed $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function requestData(int $maxBytes = 2_000_000): array
{
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
        fail(415, 'Format de requête invalide.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw !== false && strlen($raw) > $maxBytes) {
        fail(413, 'Le fichier est trop volumineux.');
    }
    try {
        $body = json_decode($raw ?: '', true, flags: JSON_THROW_ON_ERROR);
        if (is_array($body) && str_starts_with(ltrim($raw), '{')) {
            return $body;
        }
    } catch (JsonException) {
        // La réponse d’erreur est commune aux contenus JSON invalides.
    }
    fail(400, 'Données invalides.');
}

function setting(string $name, string $default = ''): string
{
    $value = getenv($name);
    return $value === false || $value === '' ? $default : $value;
}

function clean(mixed $value): string
{
    return is_string($value) ? trim(preg_replace('/\s+/u', ' ', $value) ?? '') : '';
}

function normalize(mixed $value): string
{
    $decomposed = Normalizer::normalize(clean($value), Normalizer::FORM_D);
    $bare = preg_replace('/\p{M}/u', '', $decomposed ?: '') ?? '';
    return strtr(mb_strtolower($bare, 'UTF-8'), ['œ' => 'oe', 'æ' => 'ae']);
}

function words(mixed $value): string
{
    return trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', normalize($value)) ?? '');
}

function label(mixed $value, string $field, int $limit = 100): string
{
    $text = clean($value);
    if ($text === '' || mb_strlen($text, 'UTF-8') > $limit) {
        fail(400, "$field doit contenir entre 1 et $limit caractères.");
    }
    return $text;
}

function uid(): string
{
    $hex = bin2hex(random_bytes(16));
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3)
        . '-a' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12);
}

function barcode(): string
{
    return 'CDI' . strtoupper(bin2hex(random_bytes(5)));
}

function clockMs(): int
{
    return (int) floor(microtime(true) * 1000);
}

function parisDate(int $clock): DateTimeImmutable
{
    return (new DateTimeImmutable('@' . intdiv($clock, 1000)))->setTimezone(new DateTimeZone('Europe/Paris'));
}

function parisClock(int $clock): array
{
    $local = parisDate($clock);
    return ['day' => $local->format('Y-m-d'), 'weekday' => (int) $local->format('N'),
        'minute' => (int) $local->format('G') * 60 + (int) $local->format('i')];
}

function fullHour(int $clock, int $slots = 1): int
{
    return (intdiv($clock, HOUR_MS) + $slots) * HOUR_MS;
}

function validDay(mixed $day): bool
{
    if (!is_string($day) || !preg_match('/^(20|21)\d{2}-\d{2}-\d{2}$/D', $day)) {
        return false;
    }
    [$year, $month, $date] = array_map('intval', explode('-', $day));
    return checkdate($month, $date, $year);
}

function midnight(string $day, string $timezone = 'Europe/Paris'): DateTimeImmutable
{
    return new DateTimeImmutable($day . ' 00:00:00', new DateTimeZone($timezone));
}

function shiftDay(string $day, int $days): string
{
    return midnight($day, 'UTC')->modify(sprintf('%+d days', $days))->format('Y-m-d');
}

function weekday(string $day): int
{
    return (int) midnight($day, 'UTC')->format('N');
}

function q(string $key, string $default = ''): string
{
    return is_string($_GET[$key] ?? null) ? $_GET[$key] : $default;
}

function audit(Store $db, array $me, string $area, string $action, string $target, ?array $before, ?array $after): void
{
    $db->run('INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?)', uid(), clockMs(), $me['name'],
        $area, $action, $target, $before === null ? null : jsonData($before), $after === null ? null : jsonData($after));
}

function need(array $me, string ...$rights): void
{
    if (!array_intersect($rights, $me['rights'])) {
        fail(403, 'Votre compte ne dispose pas de cet accès.');
    }
}

function adminOnly(array $me): void
{
    if (!$me['admin']) {
        fail(403, 'Cette rubrique est réservée aux administrateurs.');
    }
}

function throttle(Store $db, string $scope, int $limit, int $minutes = 1): void
{
    $slot = intdiv(clockMs(), $minutes * 60_000) * $minutes;
    $count = $db->atomic(function () use ($db, $scope, $slot): int {
        $db->run('DELETE FROM rate_limits WHERE slot<?', $slot - 60);
        return $db->one(
            'INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(scope,slot) DO UPDATE SET count=count+1 RETURNING count',
            $scope, $slot
        )['count'];
    });
    if ($count > $limit) {
        fail(429, 'Trop de tentatives. Réessayez dans quelques instants.');
    }
}

function publicAccount(array $row): array
{
    return ['id' => $row['id'], 'username' => $row['username'], 'name' => $row['name'],
        'admin' => (bool) $row['admin'], 'rights' => $row['admin'] ? RIGHTS : json_decode($row['permissions'], true)];
}

function sessionToken(): ?string
{
    $value = $_COOKIE['cdi_session'] ?? '';
    return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value) ? $value : null;
}

function authenticate(Store $db, int $clock): ?array
{
    $token = sessionToken();
    $key = $token === null ? null : hash('sha256', $token);
    $row = $key === null ? null : $db->one(
        'SELECT a.*,t.last_seen AS session_seen,s.idle_minutes,s.mfa_policy,
         EXISTS(SELECT 1 FROM account_mfa f WHERE f.account_id=a.id AND f.secret IS NOT NULL) AS has_mfa
         FROM sessions t JOIN accounts a ON a.id=t.account_id LEFT JOIN security_settings s ON s.id=1
         WHERE t.token=? AND t.expires_at>?',
        $key, $clock
    );
    if (!$row) {
        return null;
    }
    // Déconnexion après inactivité : les actualisations automatiques (X-CDI-Background) ne comptent pas comme activité.
    $idle = (int) ($row['idle_minutes'] ?? 0);
    if ($idle > 0 && (int) $row['session_seen'] > 0 && (int) $row['session_seen'] < $clock - $idle * 60_000) {
        $db->run('DELETE FROM sessions WHERE token=?', $key);
        return null;
    }
    if (($_SERVER['HTTP_X_CDI_BACKGROUND'] ?? '') !== '1' && (int) $row['session_seen'] < $clock - 60_000) {
        $db->run('UPDATE sessions SET last_seen=? WHERE token=?', $clock, $key);
    }
    $mfa = (bool) $row['has_mfa'];
    $policy = $row['mfa_policy'] ?? 'none';
    return publicAccount($row) + ['mfa' => $mfa, 'mfa_missing' => !$mfa && ($policy === 'all' || ($policy === 'admins' && (int) $row['admin'] === 1))];
}

function cookie(string $token, int $expires, string $name = "cdi_session", string $sameSite = 'Strict'): void
{
    $secure = isHttps();
    $prefix = rtrim(str_replace('\\', '/', dirname(entryPath())), '/');
    setcookie($name, $token, [
        'expires' => $expires, 'path' => ($prefix === '.' ? '' : $prefix) . '/',
        'secure' => $secure, 'httponly' => true, 'samesite' => $sameSite,
    ]);
}

function entryPath(): string
{
    $path = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    return is_string($path) && preg_match('~^/(?:[^/]+/)*index\.php$~D', $path) ? $path : '/index.php';
}

function startLogin(Store $db, string $account, int $clock): array
{
    $token = bin2hex(random_bytes(32));
    $expires = $clock + 12 * HOUR_MS;
    $db->run('DELETE FROM sessions WHERE expires_at<=?', $clock);
    $db->run('INSERT INTO sessions (token,account_id,expires_at,created_at,last_seen,agent,address) VALUES (?,?,?,?,?,?,?)',
        hash('sha256', $token), $account, $expires, $clock, $clock,
        agentSummary((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), substr(clientAddress(), 0, 64));
    cookie($token, intdiv($expires, 1000));
    return ['ok' => true];
}

function username(mixed $value): string
{
    $name = strtolower(clean($value));
    if (!preg_match('/^[a-z0-9][a-z0-9_.@-]{2,79}$/D', $name)) {
        fail(400, 'Saisissez un identifiant de 3 à 80 caractères, sans accents ni espaces.');
    }
    return $name;
}

function newPassword(mixed $value): string
{
    if (!is_string($value) || mb_strlen($value, 'UTF-8') < 12 || mb_strlen($value, 'UTF-8') > 160) {
        fail(400, 'Le mot de passe doit contenir entre 12 et 160 caractères.');
    }
    return $value;
}

// PBKDF2-SHA256 à 600 000 itérations, format « pbkdf2$itérations$sel$empreinte » partagé avec l’édition Docker.
// L’ancien format « sel:empreinte » (100 000 itérations) reste accepté et est converti à la connexion suivante.
const PASSWORD_ITERATIONS = 600_000;

function passwordSecret(string $password): string
{
    $salt = bin2hex(random_bytes(16));
    return 'pbkdf2$' . PASSWORD_ITERATIONS . '$' . $salt . '$' . hash_pbkdf2('sha256', $password, $salt, PASSWORD_ITERATIONS, 64);
}

/** @return array{ok: bool, upgrade: bool} */
function verifyPassword(string $password, ?string $stored): array
{
    $params = null;
    if (is_string($stored) && preg_match('/^([a-f0-9]{32}):([a-f0-9]{64})$/D', $stored, $match)) {
        $params = [100_000, $match[1], $match[2]];
    } elseif (is_string($stored) && preg_match('/^pbkdf2\$(\d{6,7})\$([a-f0-9]{32})\$([a-f0-9]{64})$/D', $stored, $match)
        && (int) $match[1] >= 100_000 && (int) $match[1] <= 5_000_000) {
        $params = [(int) $match[1], $match[2], $match[3]];
    }
    [$iterations, $salt, $hash] = $params ?? [PASSWORD_ITERATIONS, str_repeat('0', 32), ''];
    $ok = hash_equals($hash, hash_pbkdf2('sha256', $password, $salt, $iterations, 64)) && $params !== null;
    return ['ok' => $ok, 'upgrade' => $ok && $iterations < PASSWORD_ITERATIONS];
}

function clientAddress(): string
{
    $address = $_SERVER['REMOTE_ADDR'] ?? 'borne';
    if (setting('CDI_TRUST_PROXY') === '1' && is_string($_SERVER['HTTP_X_FORWARDED_FOR'] ?? null)) {
        $chain = array_values(array_filter(array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']))));
        if ($chain && filter_var(end($chain), FILTER_VALIDATE_IP)) {
            $address = end($chain);
        }
    }
    return $address;
}

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || str_starts_with(setting('CDI_ORIGIN'), 'https://')
        || (setting('CDI_TRUST_PROXY') === '1' && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function securityHeaders(): void
{
    header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), fullscreen=(self)');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('X-Robots-Tag: noindex, nofollow');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (isHttps()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

function paramIds(mixed $value, int $max = 500): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > $max) {
        fail(400, 'Sélectionnez des fiches élèves valides.');
    }
    foreach ($value as $id) {
        if (!is_string($id) || $id === '' || strlen($id) > 80) {
            fail(400, 'Sélectionnez des fiches élèves valides.');
        }
    }
    return array_values(array_unique($value));
}

function ensureSetupKey(string $directory): string
{
    $configured = setting('CDI_SETUP_KEY');
    if ($configured !== '') {
        return $configured;
    }
    $path = $directory . '/installation.key';
    $handle = fopen($path, 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) {
        throw new RuntimeException('Impossible d’ouvrir la clé de première configuration');
    }
    try {
        $value = trim(stream_get_contents($handle) ?: '');
        if ($value === '') {
            $value = bin2hex(random_bytes(16));
            if (fwrite($handle, $value . "\n") !== strlen($value) + 1) {
                throw new RuntimeException('Clé de première configuration non enregistrée');
            }
        }
        return $value;
    } finally {
        fclose($handle);
    }
}
