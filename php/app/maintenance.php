<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    return;
}
umask(0077);
require __DIR__ . '/core.php';
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/privacy.php';

try {
    $_SERVER['DOCUMENT_ROOT'] = $argv[1] ?? dirname(__DIR__);
    setup();
    $db = new Store(privateDataDirectory(), dirname(__DIR__) . '/drizzle');
    $result = $db->atomic(static fn () => maintain($db, clockMs()));
    echo gmdate('c', intdiv($result['last_success'],1000)) . " TiceCDI · purge terminée\n";
} catch (Throwable $error) {
    fwrite(STDERR, "TiceCDI · échec de la purge. Vérifiez le chemin, la configuration et les droits PHP.\n");
    exit(1);
}
