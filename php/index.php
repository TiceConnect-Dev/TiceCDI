<?php
declare(strict_types=1);

ini_set('display_errors', '0');
umask(0077);
require __DIR__ . '/app/core.php';

function privateDataDirectory(): string
{
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if (!$root) {
        throw new RuntimeException('Racine web indéterminée');
    }
    $default = dirname($root) . '/gestion-cdi-' . substr(hash('sha256', __DIR__), 0, 10) . '-data';
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
        || !extension_loaded('intl') || !extension_loaded('mbstring')) {
        throw new RuntimeException('PHP 8.3+ 64 bits, PDO SQLite, intl et mbstring requis');
    }
    $configPath = __DIR__ . '/config.local.php';
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

function renderPage(string $path): void
{
    $entry = htmlspecialchars(entryPath(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $assets = rtrim(dirname($entry), '/') . '/cdi';
    $title = $path === '/planning-ecran' ? 'Planning du CDI' : (str_starts_with($path, '/gestion') ? 'Espace de gestion' : 'Accueil du CDI');
    header('Content-Type: text/html; charset=utf-8');
    header('Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; object-src \'none\'; base-uri \'none\'; form-action \'self\'; frame-ancestors \'self\'');
    echo <<<HTML
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#000091">
  <meta name="cdi-entry" content="$entry">
  <title>$title | Gestion du CDI</title>
  <link rel="icon" href="$assets/favicon.svg">
  <link rel="stylesheet" href="$assets/cdi.css">
  <script type="module" src="$assets/app.js"></script>
</head>
<body>
  <a class="skip" href="#main">Aller au contenu</a>
  <div id="app"><p class="loading" role="status">Chargement du CDI…</p></div>
</body>
</html>
HTML;
}

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
$path = rtrim(q('route', '/'), '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if (str_starts_with($path, '/api/') || $path === '/healthz') {
        setup();
        $migrations = __DIR__ . '/drizzle';
        if (!is_file($migrations . '/0000_cute_jubilee.sql')) {
            throw new RuntimeException('Migrations SQL introuvables');
        }
        $dataDir = privateDataDirectory();
        $db = new Store($dataDir, $migrations);
        if ($path === '/healthz' && $method === 'GET') {
            header('Content-Type: text/plain; charset=utf-8');
            echo 'ok';
            return;
        }
        foreach (['people', 'planning', 'presence', 'attendance', 'backup', 'api'] as $module) {
            require __DIR__ . '/app/' . $module . '.php';
        }
        header('Content-Type: application/json; charset=utf-8');
        echo jsonData(api($db, $path, $method, $dataDir));
    } elseif (preg_match('~^/(?:borne|planning-ecran|connexion|gestion(?:/[a-z-]+)?)?$~D', $path)) {
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            fail(405, 'Méthode indisponible.');
        }
        renderPage($path);
    } else {
        fail(404, 'Page introuvable.');
    }
} catch (RequestError $error) {
    http_response_code($error->status);
    header_remove('Content-Disposition');
    header('Content-Type: application/json; charset=utf-8');
    echo jsonData(['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Gestion-CDI PHP · ' . $error::class . ' · ' . $error->getMessage());
    http_response_code(500);
    header_remove('Content-Disposition');
    header('Content-Type: application/json; charset=utf-8');
    echo jsonData(['error' => 'Le service est indisponible. Vérifiez les prérequis PHP et les journaux du serveur.']);
}
