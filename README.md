<div align="center">
  <img src="public/cdi/favicon.svg" width="64" height="64" alt="">
  <h1>Gestion du CDI</h1>
  <p><strong>Cité scolaire Camille Claudel · Fourmies</strong></p>
  <p>Borne de pointage, suivi des présences et planning du centre de documentation et d’information.</p>
  <p><a href="#installation">Installations</a> · <a href="#fonctionnalités">Fonctionnalités</a> · <a href="MANUEL.md">Manuel d’utilisation</a></p>
</div>

## Fonctionnalités

| Espace | Ce qu’il permet |
| --- | --- |
| **Borne élèves** | Scanner une carte CDI ou rechercher un élève dans le même champ. Voir le départ prévu et les places disponibles quand la jauge est activée. |
| **Présences** | Consulter les élèves présents, prolonger de 15 ou 30 minutes, enregistrer une sortie ou gérer une exclusion avec un motif. |
| **Fiches d’appel** | Pointer une classe ou un groupe, décocher les absents, corriger les statuts et terminer la séance en une action. |
| **Planning** | Programmer les cours, ateliers et fermetures, déplacer les créneaux, afficher le planning sur un écran et imprimer le PDF du jour ou de la semaine. |
| **Annuaire** | Importer des élèves par CSV, affecter les classes, gérer les groupes et imprimer les cartes Code 128. |
| **Administration** | Régler les horaires et la jauge, distribuer les droits, consulter les statistiques, archiver une année et gérer les sauvegardes JSON. |

Un pointage à **8 h 30** expire à **9 h**, ou à **10 h** avec l’option deuxième heure. À l’échéance, la présence sort de la liste et la place est libérée. Les horaires sont exprimés en heure de Paris.

## Installation

| Méthode | À récupérer | Documentation |
| --- | --- | --- |
| **PHP · hébergement classique** | [Archive PHP à décompresser](https://github.com/Xeros59/Gestion-CDI/releases/latest/download/Gestion-CDI-PHP.zip) | [Installation PHP et XAMPP](docs/INSTALLATION-PHP.md) |
| **Docker · Portainer** | [Image Docker à importer](https://github.com/Xeros59/Gestion-CDI/releases/latest/download/Gestion-CDI-Docker-amd64.tar.gz) et [stack prête à coller](compose.portainer.yaml) | [Installation Portainer](docs/INSTALLATION-PORTAINER.md) |
| **Docker · depuis les sources** | [Code du dépôt](https://github.com/Xeros59/Gestion-CDI) | [Démarrage avec Docker Compose](#démarrer-avec-docker-compose) |

### Démarrer avec Docker Compose

Utilise Docker avec la commande `docker compose`. Le conteneur embarque Node.js 24 et les données sont stockées dans SQLite.

```bash
git clone https://github.com/Xeros59/Gestion-CDI.git
cd Gestion-CDI
cp .env.example .env
docker compose up -d --build
docker compose logs cdi
```

1. Sur le serveur, ouvre [l’espace de gestion](http://127.0.0.1:8080/gestion).
2. Saisis la **clé de première configuration** affichée dans les journaux, puis crée le premier compte administrateur.
3. Pour accéder au service depuis le réseau de l’établissement, définis `CDI_BIND_IP` avec l’adresse IP du serveur dans `.env`, puis relance `docker compose up -d`.
4. Depuis **Importer des élèves**, télécharge le modèle CSV pour préparer le premier import.

| Adresse à ajouter à l’URL du serveur | Accès |
| --- | --- |
| `/borne` | Borne élèves, sans compte CDI |
| `/planning-ecran` | Planning plein écran, sans compte CDI |
| `/gestion` | Espace du personnel, avec compte CDI |
| `/healthz` | Vérification HTTP du service |

> [!IMPORTANT]
> Garde la borne sur le réseau de l’établissement. Elle permet de rechercher des élèves. Les fichiers d’import, les sauvegardes et le volume SQLite contiennent des données nominatives et sont à stocker dans les espaces internes prévus à cet effet.

### Démarrer sans Docker

Avec Node.js 24, lance la commande suivante depuis la racine du dépôt. Le serveur utilise `./data` et le port `8080` par défaut.

```bash
node standalone/server.mjs
```

Pour choisir le dossier de données ou le port, renseigne `CDI_DATA_DIR` ou `PORT` avant le lancement.

## Exploitation

- **Données.** En Docker, le volume nommé `cdi_data` est monté sur `/data`. Garde le même projet Compose et le même volume lors des mises à jour.
- **Reverse proxy HTTPS.** Renseigne `CDI_ORIGIN` avec l’origine exacte du site, par exemple `https://cdi.intranet.exemple.fr`, puis pointe le proxy vers le port publié.
- **Mise à jour.** Sauvegarde d’abord, puis lance `git pull --ff-only` et `docker compose up -d --build`. Les migrations SQLite sont appliquées au démarrage.
- **Sauvegardes.** Utilise l’export JSON pour les données de gestion du CDI. Pour une copie qui inclut aussi les comptes du personnel, arrête le service et sauvegarde le volume complet. Les étapes de restauration sont dans le [manuel](MANUEL.md#8-sauvegardes-et-restauration).

## Structure du projet

| Chemin | Contenu |
| --- | --- |
| [`cdi/`](cdi/) | API, règles de présence, planning, annuaire, sauvegardes |
| [`public/cdi/`](public/cdi/) | Borne, écrans de gestion, planning et génération des PDF |
| [`standalone/`](standalone/) | Serveur HTTP Node.js et adaptateur SQLite |
| [`php/`](php/) | Serveur PHP, SQLite et sauvegardes JSON compatibles |
| [`scripts/build-php.sh`](scripts/build-php.sh) | Assemblage du ZIP PHP avec les ressources de l’interface |
| [`drizzle/`](drizzle/) | Migrations SQL appliquées au démarrage |
| [`compose.yaml`](compose.yaml) et [`Dockerfile`](Dockerfile) | Configuration du déploiement autonome |

Le [manuel d’utilisation](MANUEL.md) détaille les opérations de la vie scolaire, de l’équipe CDI et de l’administration.
