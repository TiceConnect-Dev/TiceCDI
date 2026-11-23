# Installer TiceCDI avec PHP

Cette édition utilise PHP sur le serveur, SQLite pour les données et la même interface que l’édition Docker. Le ZIP d’installation contient l’application, les ressources du navigateur et les migrations SQL.

## Prérequis

- PHP **8.3 ou supérieur en 64 bits** avec les extensions **PDO SQLite**, **OpenSSL**, **intl** et **mbstring**, et SQLite **3.38 ou supérieur**.
- Un dossier accessible en écriture **hors de la racine web** pour la base de données. PHP doit être autorisé à y accéder, notamment si l’hébergeur limite les chemins avec `open_basedir`.
- Un hébergement Apache, Nginx avec PHP-FPM ou XAMPP. Les liens passent par `index.php`, ce qui permet une installation en sous-dossier avec les paramètres PHP habituels.

## Télécharger et déposer les fichiers

1. Télécharge [TiceCDI-PHP.zip](https://github.com/TiceConnect-Dev/TiceCDI/releases/latest/download/TiceCDI-PHP.zip) sur la page [Releases de GitHub](https://github.com/TiceConnect-Dev/TiceCDI/releases).
2. Décompresse l’archive et dépose le dossier `Gestion-CDI-PHP` dans le répertoire web de l’hébergement. Lors d’une mise à jour, conserve exactement le dossier et l’URL de l’installation existante.
3. Crée un dossier privé hors de la racine web. Copie `config.example.php` en `config.local.php`, puis remplis `CDI_DATA_DIR` avec le chemin absolu du dossier privé. Les mêmes paramètres peuvent être fournis comme variables d’environnement.

Sur un hébergement Linux, si la racine web est `/home/moncompte/public_html`, le dossier privé peut être `/home/moncompte/gestion-cdi-data`. Sous XAMPP, si le dossier public est `C:/xampp/htdocs`, utilise par exemple `C:/xampp/gestion-cdi-data`. Laisse au compte qui exécute PHP l’accès en écriture à ce dossier.

```php
<?php
return [
    'CDI_DATA_DIR' => '/home/moncompte/gestion-cdi-data',
    'CDI_ORIGIN' => 'https://cdi.exemple.fr',
    'CDI_TRUST_PROXY' => '0',
];
```

Si la configuration est laissée par défaut et que PHP dispose des droits, l’application crée un dossier `gestion-cdi-…-data` à côté de la racine web. Avec un reverse proxy HTTPS, renseigne dans `CDI_ORIGIN` l’origine externe exacte, par exemple `https://cdi.intranet.exemple.fr`, sans chemin ni barre oblique finale.

## Première connexion

1. Ouvre `index.php?route=/gestion` dans le dossier installé.
2. Lis le fichier `installation.key` dans le dossier privé configuré avec ton gestionnaire de fichiers ou en SSH.
3. Saisis la clé puis crée ton compte administrateur avec un mot de passe de 12 caractères minimum.
4. Renseigne **Établissement et données personnelles**, programme la purge, puis teste la borne. Importe les élèves une fois ces réglages validés. Les étapes d’utilisation sont détaillées dans le [manuel du CDI](https://github.com/TiceConnect-Dev/TiceCDI/blob/main/MANUEL.md).

| Page | Adresse à ajouter au dossier d’installation |
| --- | --- |
| Borne élèves | `index.php?route=/borne` |
| Planning à afficher | `index.php?route=/planning-ecran` |
| Administration | `index.php?route=/gestion` |
| Vérification | `index.php?route=/healthz` |

## Sécuriser le serveur web

Sers TiceCDI **en HTTPS** sur une infrastructure autorisée. Les données SQLite restent hors de la racine web. `index.php` envoie lui-même les en-têtes de sécurité (CSP, `X-Frame-Options`, `Permissions-Policy`, HSTS en HTTPS…).

**Apache et XAMPP.** Le ZIP contient un `.htaccess` qui interdit `app/`, `drizzle/`, `config.*.php`, les fichiers cachés et sensibles, désactive la liste des dossiers, limite les méthodes HTTP et ajoute les en-têtes de sécurité aux fichiers du dossier `cdi/`. Il nécessite `AllowOverride All` (valeur par défaut de XAMPP). Une fois le site uniquement en HTTPS, décommente la ligne `Strict-Transport-Security` du `.htaccess`.

**Nginx.** Les fichiers `.htaccess` sont ignorés : reproduis les règles dans le bloc `server`. Exemple pour une installation dans `/cdi` :

```nginx
location ^~ /cdi/app/      { deny all; }
location ^~ /cdi/drizzle/  { deny all; }
location ~ ^/cdi/config\..*\.php$ { deny all; }
location ~ /\.            { deny all; }
location ~* \.(sql|sqlite3?|db|key|md|log|bak|ini|json|zip|sh)$ { deny all; }

location ^~ /cdi/cdi/ {
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
}
location = /cdi/index.php {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
}
autoindex off;
server_tokens off;
client_max_body_size 24m;
```

**Derrière un reverse proxy.** Renseigne `CDI_ORIGIN` avec l’adresse HTTPS publique. Mets `CDI_TRUST_PROXY` à `'1'` seulement si le serveur PHP n’est joignable que par ce proxy : la limitation des tentatives de connexion utilise alors l’adresse réelle transmise dans `X-Forwarded-For`.

**Borne installable (PWA).** Le service worker est servi par `index.php?route=/sw.js` et le manifeste par `cdi/manifest.webmanifest`. L’installation de la borne et le maintien de l’écran allumé exigent HTTPS. Si le serveur renvoie le manifeste en `text/plain`, ajoute `AddType application/manifest+json .webmanifest` dans la configuration Apache (ou `application/manifest+json webmanifest;` dans `mime.types` pour Nginx).

**Connexion ENT.** TiceCDI contacte le serveur CAS ou OpenID Connect de l’ENT : l’extension `curl` (recommandée) ou `allow_url_fopen=On` est nécessaire, ainsi qu’un accès sortant en HTTPS depuis le serveur. Renseigne `CDI_ORIGIN` pour que l’adresse de retour déclarée à l’ENT soit exacte.

**PHP.** Utilise une version maintenue, laisse `display_errors=Off` en production et, si possible, `expose_php=Off` dans `php.ini`. Après la création du compte administrateur, supprime `installation.key` du dossier privé.

## Programmer la purge

Configure une tâche planifiée toutes les cinq minutes avec le PHP 8.3+ du serveur. Indique la vraie racine web, le même fichier de configuration et le même dossier de données que le site. Sous Linux, voici une entrée cron à adapter.

```cron
*/5 * * * * /usr/bin/php /home/moncompte/public_html/cdi/app/maintenance.php /home/moncompte/public_html
```

Sous Windows, crée une tâche dans le Planificateur. Utilise `php.exe` comme programme et passe le chemin de `app/maintenance.php` puis la racine web en arguments. Si le site utilise des variables d’environnement pour sa configuration, fournis les mêmes variables au processus planifié. Vérifie le dernier succès dans **Établissement et données personnelles**. Les requêtes peuvent aussi relancer la tâche si elle est en retard.

## Mise à jour et transfert

- **Mise à jour.** Sauvegarde les données, puis remplace les fichiers de l’application avec ceux du nouveau ZIP, y compris `.htaccess`. Conserve `config.local.php` et le dossier privé. Les migrations s’appliquent au démarrage et les mots de passe passent au nouveau hachage à la connexion suivante de chaque agent.
- **Docker vers PHP ou PHP vers Docker.** Depuis l’instance d’origine, télécharge la sauvegarde chiffrée et l’état de reprise. À destination, initialise ton compte administrateur, ouvre **Sauvegarde et restauration**, importe l’état de reprise à jour, puis analyse et confirme la sauvegarde. Les comptes du personnel sont gérés séparément.
- **Copie complète de l’édition PHP.** Interromps l’accès au service le temps de copier tout le dossier privé, qui contient la base SQLite et les comptes. Pour restaurer une copie de l’infrastructure, réapplique l’état de reprise à jour avant de rouvrir. Stocke cette copie dans un emplacement interne autorisé.

## Dépannage

Pour restaurer un fichier JSON volumineux, autorise des requêtes d’au moins 20 Mo sur PHP et sur le reverse proxy. Sur un hébergement classique, un `post_max_size` de `24M` couvre la limite de sauvegarde du CDI.

| Symptôme | À vérifier |
| --- | --- |
| La clé n’apparaît pas | Charge la page de gestion une première fois, puis regarde dans `CDI_DATA_DIR` et vérifie le droit d’écriture. |
| « Le service est indisponible » | Ouvre `index.php?route=/healthz` et vérifie le journal PHP, les extensions requises et `open_basedir`. |
| La page reste sur « Chargement du CDI… » | Vérifie que le dossier `cdi/` du ZIP a été copié à côté d’`index.php` et que le serveur peut servir les fichiers JavaScript et CSS. |
| Le formulaire renvoie une erreur d’origine | Vérifie l’adresse indiquée dans `CDI_ORIGIN` et l’origine réellement ouverte dans le navigateur. |
| Erreur 500 juste après la mise à jour (Apache) | L’hébergeur interdit `Options` dans `.htaccess`. Supprime la ligne `Options -Indexes` et désactive la liste des dossiers dans la configuration du serveur. |
| Connexion plus lente qu’avant | Normal : le hachage renforcé prend une fraction de seconde à chaque connexion. |

Pour fabriquer le ZIP à partir des sources GitHub sur Linux ou macOS, exécute `bash scripts/build-php.sh` depuis la racine du dépôt. L’archive apparaît dans `dist/TiceCDI-PHP.zip`.
