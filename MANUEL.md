# Manuel d’utilisation · Gestion du CDI

Ce manuel s’adresse à l’équipe du CDI, à la vie scolaire et à la personne qui administre l’application. Les intitulés en **gras** correspondent aux rubriques de l’interface.

## Sommaire

1. [Mise en service](#1-mise-en-service)
2. [Borne et présences](#2-borne-et-présences)
3. [Arrivées groupées et appel](#3-arrivées-groupées-et-appel)
4. [Planning, horaires et écran](#4-planning-horaires-et-écran)
5. [Élèves, classes et cartes](#5-élèves-classes-et-cartes)
6. [Comptes et droits](#6-comptes-et-droits)
7. [Statistiques, journal et année scolaire](#7-statistiques-journal-et-année-scolaire)
8. [Sauvegardes et restauration](#8-sauvegardes-et-restauration)
9. [Dépannage](#9-dépannage)

## 1. Mise en service

Pour installer le service, utilise le [guide PHP](docs/INSTALLATION-PHP.md), le [guide Portainer](docs/INSTALLATION-PORTAINER.md) ou [Docker Compose depuis les sources](README.md#installation). Pour une première mise en service dans l’établissement, procède dans cet ordre.

1. Ouvre l’espace de gestion avec l’adresse indiquée par ton guide d’installation. Crée le compte administrateur avec la clé obtenue dans les journaux Docker ou dans le fichier `installation.key` de l’édition PHP. Le mot de passe doit comporter au moins 12 caractères.
2. Ajoute les classes et les élèves manuellement ou importe le CSV. Fais les premiers essais avec des fiches fictives.
3. Dans **Réglages de la borne**, configure le message d’accueil, la capacité du CDI, la deuxième heure et les horaires.
4. Crée un compte par personne dans **Comptes et droits**, puis attribue les accès correspondant à ses missions.
5. Ouvre `/borne` sur le poste d’accueil et `/planning-ecran` sur l’écran d’affichage. Place les deux pages en plein écran si nécessaire.
6. Teste un pointage, une sortie et un export PDF avant de distribuer les cartes aux élèves.

## 2. Borne et présences

### Enregistrer une arrivée

1. Place le curseur dans le champ unique de la borne.
2. Si l’option est disponible et que l’élève souhaite rester jusqu’à la deuxième heure pleine, coche la case **avant** de scanner ou de valider.
3. Scanne le code-barres, saisis le code manuellement ou tape le nom ou le prénom. Pour une recherche par nom, sélectionne la bonne fiche dans la liste.
4. Lis la confirmation qui indique l’heure de départ prévue.

| Arrivée | Pointage standard | Avec la deuxième heure |
| --- | --- | --- |
| 8 h 30 | Départ à 9 h | Départ à 10 h |
| 8 h 55 | Départ à 9 h | Départ à 10 h |
| 9 h pile | Départ à 10 h | Départ à 11 h |

Un nouveau scan d’une fiche déjà présente rappelle son échéance. Quand l’inscription est fermée, la jauge est pleine ou une exclusion est active, la borne affiche le message correspondant. La jauge est recalculée lorsqu’une présence prend fin.

### Gérer les élèves présents

- Dans **Présences**, recherche un élève ou filtre par classe. La liste affiche l’arrivée et le départ prévu.
- Clique sur **Prolonger**, choisis **15** ou **30 minutes**, puis valide. La durée est ajoutée au départ prévu. Par exemple, une prolongation de 15 minutes décale un départ de 9 h à 9 h 15.
- Clique sur **Sortie** pour libérer la place avant l’échéance.
- Pour exclure un élève, clique sur **Exclure**, choisis une date de fin et renseigne le motif. L’exclusion clôture la présence en cours et bloque les nouvelles arrivées jusqu’à la fin de la date choisie. Elle peut être levée depuis **Exclusions**.

## 3. Arrivées groupées et appel

1. Va dans **Présences → Arrivée groupée** et sélectionne la classe ou le groupe. Tu peux aussi ouvrir le cours du jour depuis le **Planning du CDI** si un effectif lui est rattaché.
2. Choisis le départ prévu. Les options vont de la prochaine heure pleine à la quatrième heure pleine.
3. Décoche les absents. Relis l’effectif coché puis clique sur **Enregistrer l’appel**.
4. Dans **Fiches d’appel**, ouvre la séance pour corriger les statuts, voir qui est toujours présent ou exporter l’appel au format CSV. Si la capacité est atteinte, les élèves concernés apparaissent **En attente de place**. Une fois une place libre, mets à jour leur statut pour enregistrer leur arrivée.
5. Choisis **Terminer la séance** pour clôturer les présences de la séance. Tu peux cocher les élèves qui restent au CDI et garder leur échéance prévue.

La fiche d’appel conserve l’effectif enregistré à l’ouverture, même si la composition de la classe ou du groupe change ensuite.

## 4. Planning, horaires et écran

### Régler l’ouverture

Dans **Réglages de la borne**, utilise **Accepter les nouvelles arrivées** pour ouvrir ou fermer manuellement les inscriptions. La fermeture manuelle laisse les élèves déjà pointés dans la liste jusqu’à leur départ. Active les horaires automatiques pour appliquer des plages d’ouverture récurrentes. Chaque jour peut contenir jusqu’à quatre plages, par exemple **8 h–12 h** et **13 h–16 h**. Un jour sans plage est fermé lorsque les horaires automatiques sont activés.

Une **fermeture** inscrite dans le planning bloque la borne pendant son créneau. Un cours peut être affiché sur le planning sans être une fermeture.

### Préparer le planning et les exports

1. Dans **Planning du CDI**, sélectionne la semaine et ajoute un créneau.
2. Renseigne la date, les heures, le titre et le type. Associe éventuellement une classe ou un groupe. Utilise les notes pour les informations du personnel.
3. Déplace un créneau par glisser-déposer par pas de 15 minutes. Clique dessus pour modifier ses horaires au formulaire. Le planning refuse les chevauchements.
4. Utilise **Copier la semaine** pour reporter les créneaux vers la semaine suivante. Les créneaux qui se chevaucheraient sont ignorés.
5. Utilise **PDF de la semaine** ou **PDF d’une journée** pour imprimer une grille **A4 paysage**. Les plages **Ouvert**, **Fermé** et les cours ou activités apparaissent à leurs horaires respectifs. Le réglage **Masquer samedi et dimanche** s’applique par défaut, avec une option dans le planning pour l’export en cours.

Sur l’écran d’affichage, ouvre `/planning-ecran`, puis choisis la vue **Jour** ou **Semaine**. Elle s’actualise automatiquement. Les notes internes sont visibles depuis la gestion.

## 5. Élèves, classes et cartes

### Importer l’annuaire

1. Ouvre **Importer des élèves** et télécharge le modèle.
2. Prépare un CSV UTF-8 avec les colonnes `Nom`, `Prénom` et `Classe`. Ajoute `Identifiant externe` si ton annuaire fournit un identifiant stable par élève. L’application accepte les séparateurs point-virgule, virgule et tabulation, jusqu’à 5 000 fiches par fichier.
3. Sélectionne le fichier, vérifie l’aperçu et confirme l’import. Les classes manquantes et les codes CDI sont créés automatiquement.

Exemple avec des données fictives.

```csv
Nom;Prénom;Classe;Identifiant externe
Martin;Camille;6e A;EXEMPLE-01
Bernard;Noé;5e B;EXEMPLE-02
```

Un identifiant externe stable permet de retrouver la même fiche lors d’un changement de classe. Sans identifiant externe, le rapprochement utilise le nom, le prénom et la classe. Pour déplacer ponctuellement un élève, change sa classe dans **Élèves → Modifier**.

### Classes et groupes hors classe

- Dans **Classes**, crée et renomme les classes, puis vérifie leurs effectifs.
- Dans **Élèves**, ajoute une fiche, modifie son affectation ou retire l’élève de la borne. La fiche peut être réactivée par la suite.
- Dans **Groupes hors classe**, crée un groupe pour un atelier ou un club. Tu peux y mélanger plusieurs classes, puis le choisir dans une fiche d’appel ou un créneau du planning.

### Cartes et douchette

Dans **Codes-barres**, filtre par classe et choisis **Imprimer la planche**. Imprime à **100 %** sur du A4 et désactive les en-têtes et pieds de page ajoutés par le navigateur. Une douchette USB configurée en clavier **HID**, avec le suffixe **Entrée**, permet la validation après la lecture du code **Code 128**.

## 6. Comptes et droits

Dans **Comptes et droits**, crée le compte, choisis éventuellement un préréglage puis vérifie les cases avant d’enregistrer.

| Profil ou droit | Accès correspondant |
| --- | --- |
| **Vie scolaire** | Consultation des présences |
| **Équipe CDI** | Consultation, sorties, prolongations, exclusions et gestion des élèves |
| **Pointer une classe ou un groupe** | Arrivées groupées et fiches d’appel |
| **Gérer le planning** | Modification des créneaux et exports PDF |
| **Consulter les statistiques** | Statistiques et export CSV agrégé |
| **Administrateur** | Tous les accès, dont les réglages, les années scolaires, le journal, les sauvegardes et les raccourcis vers les écrans |

Le formulaire propose aussi des droits distincts pour les classes, les groupes, l’import, l’impression des codes-barres et la gestion des comptes. Une personne peut accéder à la borne et au planning d’affichage par leur adresse sur l’installation Docker, sans ouvrir une session CDI.

## 7. Statistiques, journal et année scolaire

- **Statistiques.** Choisis une période pour voir les passages et les durées observées par date, jour de la semaine, heure et classe. Le CSV de cette rubrique contient des chiffres agrégés. Pour l’appel d’une séance, exporte le CSV nominatif depuis la fiche correspondante.
- **Journal des modifications.** Un administrateur peut filtrer par rubrique et consulter la date, l’auteur et le détail des changements, par exemple pour le planning, les horaires, les groupes, l’appel, les prolongations et les restaurations.
- **Années scolaires.** Fais une sauvegarde, puis importe le CSV **complet** de la nouvelle année avec un **Identifiant externe** stable et unique pour chaque élève. Relis l’aperçu des créations, changements de classe et fiches à archiver avant de confirmer. Les fiches reconnues conservent leur code-barres. Les élèves absents du nouvel import sont archivés et les anciens effectifs restent consultables et exportables.

## 8. Sauvegardes et restauration

### Sauvegarde JSON du CDI

1. Avec un compte administrateur, ouvre **Sauvegarde et restauration → Télécharger le fichier JSON**.
2. Conserve le fichier dans un emplacement interne réservé au personnel autorisé. Il contient les fiches et codes-barres, classes, groupes, passages, exclusions, appels, planning, horaires, réglages, années et journal.
3. Pour restaurer, choisis le fichier et clique sur **Analyser le fichier**. Vérifie la date et les quantités affichées dans l’aperçu.
4. Après avoir sauvegardé l’état actuel, clique sur **Restaurer cette sauvegarde** puis confirme. La restauration remplace les données du CDI et est inscrite dans le journal.

Le fichier JSON peut être restauré entre les éditions PHP et Docker. Les comptes du personnel et les sessions de connexion sont gérés séparément. Les présences restaurées reprennent les horaires d’origine du fichier. La présence en cours s’affiche si son échéance est encore à venir.

### Copie complète du volume Docker

Pour un transfert de serveur ou une reprise complète, la copie du volume inclut la base SQLite et les comptes du personnel.

1. Repère le projet Compose et son volume `cdi_data`.
2. Arrête le service avec `docker compose stop cdi`, puis copie **tout** le contenu du volume avec l’outil de sauvegarde de l’hôte.
3. Relance le service avec `docker compose start cdi`, puis vérifie `/healthz`.
4. Pour rétablir une copie, arrête le service de destination, sauvegarde son volume actuel et rétablis le contenu complet de la copie dans le volume utilisé par le service. Relance puis vérifie une connexion administrateur et quelques fiches.

## 9. Dépannage

| Situation | Vérification |
| --- | --- |
| La borne fonctionne sur le serveur, mais pas depuis un autre poste | Vérifie `CDI_BIND_IP`, le port publié et l’accès réseau depuis le poste. Relance Compose après modification de `.env`. |
| La douchette saisit du texte sans valider | Active le suffixe **Entrée** en mode clavier HID. Vérifie la disposition clavier avec un code de test. |
| La borne affiche « fermé » | Vérifie l’interrupteur manuel, les horaires du jour et les fermetures du planning. |
| Un élève n’apparaît pas | Vérifie que la fiche est active et que le code correspond à sa carte. La recherche par nom nécessite au moins trois caractères. |
| Un élève est en attente sur une fiche d’appel | Consulte la jauge et corrige le statut une fois une place disponible. |
| Une rubrique de gestion est absente | Vérifie les droits du compte. Les rubriques sont affichées selon les autorisations. |
| L’écran affiche encore une ancienne version du planning | Vérifie la connexion de l’écran au serveur et recharge la page. Les changements sont récupérés automatiquement quand la connexion fonctionne. |
| Tu veux vérifier que le service répond | Charge `/healthz` et consulte `docker compose logs cdi`. |
