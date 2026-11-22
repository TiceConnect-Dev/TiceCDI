<?php
declare(strict_types=1);

ini_set('display_errors', '0');
umask(0077);
require __DIR__ . '/app/core.php';

require __DIR__ . '/app/bootstrap.php';

function renderPage(string $path): void
{
    $entry = htmlspecialchars(entryPath(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $assets = rtrim(dirname($entry), '/') . '/cdi';
    header('Content-Type: text/html; charset=utf-8');
    header_remove('Content-Security-Policy');
    header('Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; object-src \'none\'; base-uri \'none\'; form-action \'self\'; frame-ancestors \'self\'');
    echo <<<HTML
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#000091">
  <meta name="cdi-entry" content="$entry">
  <title>TiceCDI</title>
  <link rel="icon" href="$assets/ticecdi-icon.webp" type="image/webp">
  <link rel="apple-touch-icon" href="$assets/icon-192.png">
  <link rel="manifest" href="$assets/manifest.webmanifest">
  <link rel="stylesheet" href="$assets/cdi.css">
  <link rel="stylesheet" href="$assets/theme-dark.css">
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
securityHeaders();
$path = rtrim(q('route', '/'), '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD, POST, PATCH, DELETE');
    exit;
}

try {
    setup();
    securityHeaders();
    if (str_starts_with($path, '/api/') || $path === '/healthz') {
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
        foreach (['people', 'planning', 'presence', 'attendance', 'privacy', 'backup', 'security', 'api'] as $module) {
            require __DIR__ . '/app/' . $module . '.php';
        }
        $now=clockMs();
        if (($db->one('SELECT last_success FROM privacy_state WHERE id=1')['last_success'] ?? 0) <= $now-300_000) {
            try {
                $db->atomic(static fn () => maintain($db,$now));
            } catch (Throwable $error) {
                error_log('TiceCDI · échec de la purge');
            }
        }
        header('Content-Type: application/json; charset=utf-8');
        echo jsonData(api($db, $path, $method, $dataDir));
    } elseif ($path === '/sw.js' && in_array($method, ['GET', 'HEAD'], true)) {
        // Service worker servi depuis index.php pour couvrir toute l'application (borne comprise).
        header('Content-Type: text/javascript; charset=utf-8');
        header('Cache-Control: no-cache');
        header("Content-Security-Policy: default-src 'self'");
        readfile(__DIR__ . '/cdi/sw.js');
    } elseif (preg_match('~^/(?:borne|planning-ecran|connexion|notice|gestion(?:/[a-z-]+)?)?$~D', $path)) {
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
    error_log('TiceCDI PHP · ' . $error::class . ' · code ' . $error->getCode());
    http_response_code(500);
    header_remove('Content-Disposition');
    header('Content-Type: application/json; charset=utf-8');
    echo jsonData(['error' => 'Le service est indisponible. Vérifiez les prérequis PHP et les journaux du serveur.']);
}
