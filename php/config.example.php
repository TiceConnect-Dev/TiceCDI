<?php
declare(strict_types=1);

// Copiez ce fichier en config.local.php et adaptez le chemin au serveur.
return [
    'CDI_DATA_DIR' => '/chemin/prive/gestion-cdi-data',
    // Adresse HTTPS publique exacte, sans barre oblique finale. Exemple : https://cdi.exemple.fr
    'CDI_ORIGIN' => '',
    // Mettre '1' uniquement derrière un reverse proxy de confiance (X-Forwarded-For / X-Forwarded-Proto).
    'CDI_TRUST_PROXY' => '0',
];
