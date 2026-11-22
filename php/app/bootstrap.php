<?php
declare(strict_types=1);

function privateDataDirectory(): string
{
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if (!$root) {
        throw new RuntimeException('Racine web indéterminée');
    }
    $default = dirname($root) . '/gestion-cdi-' . substr(hash('sha256', dirname(__DIR__)), 0, 10) . '-data';
    $directory = setting('CDI_DATA_DIR', $default);
    if (!preg_match('~^(?:[A-Za-z]:)?[/\\\\]~D', $directory)) {
        throw new RuntimeException('CDI_DATA_DIR doit être un chemin absolu');
    }
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Dossier de données non accessible');
    }
    $actual = realpath($directory);
    if (!$actual) {
        throw new RuntimeException('Dossier de données introuvable');
    }
    $normalized = static function (string $path): string {
        $path = rtrim(str_replace('\\', '/', $path), '/') . '/';
        return PHP_OS_FAMILY === 'Windows' ? strtolower($path) : $path;
    };
    if (str_starts_with($normalized($actual), $normalized($root)) || !is_writable($actual)) {
        throw new RuntimeException('Le dossier de données doit être accessible en écriture et hors de la racine web');
    }
    return $actual;
}

function setup(): void
{
    if (PHP_VERSION_ID < 80300 || PHP_INT_SIZE < 8 || !extension_loaded('pdo_sqlite')
        || !extension_loaded('openssl') || !extension_loaded('intl') || !extension_loaded('mbstring')) {
        throw new RuntimeException('PHP 8.3+ 64 bits, PDO SQLite, OpenSSL, intl et mbstring requis');
    }
    $configPath = __DIR__ . '/../config.local.php';
    if (is_file($configPath)) {
        $config = require $configPath;
        if (!is_array($config)) {
            throw new RuntimeException('Configuration locale invalide');
        }
        foreach (['CDI_DATA_DIR', 'CDI_SETUP_KEY', 'CDI_ORIGIN'] as $key) {
            if (is_string($config[$key] ?? null) && setting($key) === '') {
                putenv($key . '=' . $config[$key]);
            }
        }
    }
}
