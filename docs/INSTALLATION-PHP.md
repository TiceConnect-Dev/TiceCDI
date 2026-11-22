# Installer TiceCDI avec PHP

Cette édition utilise PHP sur le serveur, SQLite pour les données et la même interface que l’édition Docker. Le ZIP d’installation contient l’application, les ressources du navigateur et les migrations SQL.

## Prérequis

- PHP **8.3 ou supérieur en 64 bits** avec les extensions **PDO SQLite**, **OpenSSL**, **intl** et **mbstring**, et SQLite **3.38 ou supérieur**.
- Un dossier accessible en écriture **hors de la racine web** pour la base de données. PHP doit être autorisé à y accéder, notamment si l’hébergeur limite les chemins avec `open_basedir`.
- Un hébergement Apache, Nginx avec PHP-FPM ou XAMPP. Les liens passent par `index.php`, ce qui permet une installation en sous-dossier avec les paramètres PHP habituels.

## Télécharger et déposer les fichiers

1. Télécharge [TiceCDI-PHP.zip](https://github.com/Xeros59/Gestion-CDI/releases/latest/download/TiceCDI-PHP.zip) sur la page [Releases de GitHub](https://github.com/Xeros59/Gestion-CDI/releases).
2. Décompresse l’archive et dépose le dossier `Gestion-CDI-PHP` dans le répertoire web de l’hébergement. Lors d’une mise à jour, conserve exactement le dossier et l’URL de l’installation existante.
3. Crée un dossier privé hors de la racine web. Copie `config.example.php` en `config.local.php`, puis remplis `CDI_DATA_DIR` avec le chemin absolu du dossier privé. Les mêmes paramètres peuvent être fournis comme variables d’environnement.

Sur un hébergement Linux, si la racine web est `/home/moncompte/public_html`, le dossier privé peut être `/home/moncompte/gestion-cdi-data`. Sous XAMPP, si le dossier public est `C:/xampp/htdocs`, utilise par exemple `C:/xampp/gestion-cdi-data`. Laisse au compte qui exécute PHP l’accès en écriture à ce dossier.

```php
<?php
return [
    'CDI_DATA_DIR' => '/home/moncompte/gestion-cdi-data',
    'CDI_ORIGIN' => '',
];
```

Si la configuration est laissée par défaut et que PHP dispose des droits, l’application crée un dossier `gestion-cdi-…-data` à côté de la racine web. Avec un reverse proxy HTTPS, renseigne dans `CDI_ORIGIN` l’origine externe exacte, par exemple `https://cdi.intranet.exemple.fr`, sans chemin ni barre oblique finale.

## Première connexion

1. Ouvre `index.php?route=/gestion` dans le dossier installé.
2. Lis le fichier `installation.key` dans le dossier privé configuré avec ton gestionnaire de fichiers ou en SSH.
3. Saisis la clé puis crée ton compte administrateur avec un mot de passe de 12 caractères minimum.
4. Renseigne **Établissement et données personnelles**, programme la purge, puis teste la borne. Importe les élèves une fois ces réglages validés. Les étapes d’utilisation sont détaillées dans le [manuel du CDI](https://github.com/Xeros59/Gestion-CDI/blob/main/MANUEL.md).

| Page | Adresse à ajouter au dossier d’installation |
| --- | --- |
| Borne élèves | `index.php?route=/borne` |
| Planning à afficher | `index.php?route=/planning-ecran` |
| Administration | `index.php?route=/gestion` |
| Vérification | `index.php?route=/healthz` |

Sur un serveur Nginx, réserve l’accès Web aux ressources du dossier `cdi/` et à `index.php`. Interdis les requêtes vers `app/`, `drizzle/` et `config.*.php`. Le ZIP fournit les règles correspondantes pour Apache lorsqu’il prend en charge les fichiers `.htaccess`. Sers TiceCDI en HTTPS sur une infrastructure autorisée. Les données SQLite restent hors de la racine web.

## Programmer la purge

Configure une tâche planifiée toutes les cinq minutes avec le PHP 8.3+ du serveur. Indique la vraie racine web, le même fichier de configuration et le même dossier de données que le site. Sous Linux, voici une entrée cron à adapter.

```cron
*/5 * * * * /usr/bin/php /home/moncompte/public_html/cdi/app/maintenance.php /home/moncompte/public_html
```

Sous Windows, crée une tâche dans le Planificateur. Utilise `php.exe` comme programme et passe le chemin de `app/maintenance.php` puis la racine web en arguments. Si le site utilise des variables d’environnement pour sa configuration, fournis les mêmes variables au processus planifié. Vérifie le dernier succès dans **Établissement et données personnelles**. Les requêtes peuvent aussi relancer la tâche si elle est en retard.

## Mise à jour et transfert

- **Mise à jour.** Sauvegarde les données, puis remplace les fichiers de l’application avec ceux du nouveau ZIP. Conserve `config.local.php` et le dossier privé. Les migrations s’appliquent au démarrage.
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

Pour fabriquer le ZIP à partir des sources GitHub sur Linux ou macOS, exécute `bash scripts/build-php.sh` depuis la racine du dépôt. L’archive apparaît dans `dist/TiceCDI-PHP.zip`.
