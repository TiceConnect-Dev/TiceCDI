# Manuel TiceCDI

Présences, planning et fréquentation du CDI · Une application de TiceConnect

## 1. Mettre en service

Suivez le [guide PHP](docs/INSTALLATION-PHP.md) ou le [guide Docker et Portainer](docs/INSTALLATION-PORTAINER.md). Au premier démarrage, créez un compte administrateur nominatif avec la clé d’installation générée localement. Attribuez un compte nominatif à chaque agent et les seuls droits utiles à ses missions. Avant l’ouverture, suivez la [check-list de sécurité](SECURITY.md#check-list-de-mise-en-production) : HTTPS, adresse publique dans `CDI_ORIGIN` et accès à la gestion limité au réseau de l’établissement.

Dans **Établissement et données personnelles**, renseignez l’identité et le contact de l’établissement, le contact du DPD, la finalité, la base légale, la source, les destinataires, l’hébergement, les durées et les modalités d’exercice des droits. Vérifiez les trois documents avant diffusion. La notice courte est accessible depuis la borne et la notice complète peut être téléchargée pour l’ENT. La fiche de registre est un modèle à valider et compléter localement.

Pour un traitement mis en œuvre localement dans un collège ou lycée public, le chef d’établissement assure la responsabilité du traitement local. L’établissement détermine la base légale, les habilitations, les durées et l’hébergement avec l’appui du DPD. Il documente son évaluation du besoin d’analyse d’impact en fonction de l’usage prévu et réalise l’AIPD lorsque le traitement présente un risque élevé. La fin de journée proposée par le logiciel est un **choix de configuration**. L’appel scolaire officiel suit les procédures de l’établissement.

[Éducation nationale – protection des données personnelles](https://www.education.gouv.fr/la-protection-des-donnees-personnelles-1421) · [CNIL – déterminer le besoin d’AIPD](https://www.cnil.fr/sites/cnil/files/atoms/files/infographie_aipd.pdf)

## 2. Borne et accès du personnel

| Habilitation | Peut effectuer |
| --- | --- |
| Vie scolaire | Consulter les présences, selon le droit attribué. |
| Personnel du CDI | Consulter et gérer les présences et prolongations selon ses droits. |
| Activer un poste | Ouvrir une borne de pointage sur un navigateur dédié pendant douze heures. |
| Exporter | Télécharger les sauvegardes chiffrées. Les exports ciblés exigent aussi le droit de consulter leur rubrique. |
| Restaurer | Analyser et appliquer une sauvegarde ou un état de reprise. |
| Traiter les dossiers individuels | Rechercher, consulter et rectifier un dossier, ou l’effacer sur demande validée. |
| Administrateur | Configurer l’établissement et les droits, accéder au journal et exécuter les opérations d’administration. |

Sur le poste dédié, ouvrez **Activation de la borne**, choisissez **Activer ce poste** et confirmez. La session du personnel se ferme et la borne s’ouvre. Une activation expirée ou révoquée nécessite une nouvelle intervention. Une restauration révoque aussi les activations en cours. Les agents chargés de la seule consultation disposent de leur propre accès dans **Présences**.

Sur la borne, scannez la carte CDI ou saisissez son code. L’élève choisit **Entrée** ou **Sortie**. Une douchette Code 128 en mode clavier HID avec suffixe Entrée peut valider l’entrée depuis le champ. La borne efface la saisie après chaque pointage et la confirmation disparaît au bout de cinq secondes. Elle n’affiche ni nom, ni annuaire, ni liste des présents.

## 3. Présences, planning et appel interne

Un pointage à 8 h 30 expire à 9 h. L’option deuxième heure, si l’établissement l’autorise, ou la prolongation d’un créneau par le personnel, porte cette échéance à 10 h. La liste des présents se recalcule côté serveur. Dans le dossier individuel, **Créneau expiré** désigne une échéance atteinte. **Sortie enregistrée** désigne une action de sortie.

Dans **Présences → Arrivée groupée**, sélectionnez une classe ou un groupe et décochez les élèves absents. La fiche d’appel sert à la gestion interne du CDI. Le personnel peut rectifier le statut, fermer une séance ou garder certains élèves au CDI. L’impression des cartes et l’export de l’appel exigent l’habilitation d’export.

Dans **Planning du CDI**, configurez les horaires et ajoutez une réservation, un cours ou une fermeture. Déplacez le créneau à la souris ou ouvrez son formulaire au clavier pour changer ses heures. Un agent habilité peut exporter le PDF du jour ou de la semaine. Les horaires ouverts, fermés et réservés sont également présentés dans **Version tableau du planning**. Pour activer l’écran sans connexion, utilisez le réglage de confidentialité. Le public reçoit uniquement les horaires et ces statuts. Les titres, affectations, notes et jauges sont réservés aux vues habilitées.

La borne, les formulaires et le planning proposent des libellés explicites, un focus visible, des commandes au clavier et des états exprimés en texte. Toute déclaration de conformité RGAA repose sur une évaluation effective de l’instance. [Évaluer et déclarer l’accessibilité](https://accessibilite.numerique.gouv.fr/obligations/evaluation-conformite/)

## 4. Import et droits individuels

Préparez un CSV avec `Nom`, `Prénom`, `Classe` et, si nécessaire, `Identifiant interne` stable pour les homonymes et les réimports. Le navigateur extrait ces champs, ignore les autres colonnes et transmet les seules valeurs retenues. Le serveur ne reçoit pas le fichier brut. Pour un passage d’année, l’identifiant interne doit être renseigné de manière stable. Conservez les documents d’origine selon les règles de votre établissement.

Dans **Dossiers individuels**, recherchez l’élève puis ouvrez son dossier. La vue distingue l’annuaire, les passages conservés, les appels internes, les exclusions et les éventuelles archives. Rectifiez les données d’identité ou utilisez l’export ciblé selon vos droits. L’effacement demande une confirmation explicite. Il supprime les données nominatives associées, invalide les anciennes copies locales de sauvegarde et enregistre un identifiant technique dans l’état de reprise pour empêcher une réapparition. Les agrégats de fréquentation sont conservés.

## 5. Purge, statistiques et journal

Le réglage **0 jour supplémentaire** conserve les passages jusqu’à la fin de leur journée (heure de Paris). Un créneau encore actif est conservé jusqu’à son échéance. Les fiches d’appel, les archives nominatives des années closes et les exclusions échues suivent aussi la purge configurée. L’annuaire des élèves en activité sert aux pointages et se gère séparément.

La tâche enregistre les totaux journaliers et les durées agrégées avant de retirer le nominatif. Les statistiques affichées regroupent les jours à faible effectif et ne présentent pas de découpage par classe, matière ou élève. Pour afficher un détail journalier, chaque jour présenté doit contenir un groupe vérifié d’au moins cinq élèves distincts. Si au moins un tel groupe existe sur la période, un total regroupé est possible. Ce seuil et les restrictions d’accès limitent la réidentification.

Sous Docker la tâche tourne au démarrage puis toutes les minutes. Sous PHP programmez [la tâche CLI](docs/INSTALLATION-PHP.md#programmer-la-purge). Le tableau de bord affiche le dernier succès. Le journal consigne les changements de droits, les opérations d’export, les restaurations et les effacements, avec une durée dédiée. Réservez les champs libres du planning et le message de la borne aux informations de service.

## 6. Sauvegardes et restauration

Dans **Sauvegarde et restauration**, créez une sauvegarde chiffrée avec une phrase secrète et conservez-la séparément dans les outils internes autorisés. Les archives locales sont limitées en nombre et expirent selon les réglages lorsque la purge est active. L’export et la restauration sont des habilitations distinctes. Les comptes et les réglages de confidentialité sont gérés sur l’instance d’accueil.

Pour restaurer, sélectionnez le fichier et analysez-le avant confirmation. Avant de rendre la restauration visible, l’application réapplique les purges et les effacements connus, et conserve les événements d’administration encore valides. Une sauvegarde historique JSON en clair peut être reprise. Protégez-la comme toute copie nominative.

Après un effacement validé et avant toute sauvegarde d’infrastructure, utilisez **Exporter l’état de reprise**. Conservez ce petit fichier chiffré, mis à jour, séparément du stockage de l’application. En cas de perte du volume, préparez le serveur hors accès usagers, saisissez les durées validées, importez l’état de reprise le plus récent avec **Importer l’état de reprise**, puis restaurez la sauvegarde. Si l’état à jour a été perdu, l’établissement doit reconstituer les demandes validées avant de rouvrir. Un ancien fichier ne contient que les décisions connues à sa date.

## 7. Mettre à jour une installation existante

Faites une sauvegarde hors accès usagers. Gardez le dossier de données PHP, le chemin d’installation, les variables et la même stack Docker avec le volume `cdi_data`. La migration ajoute les nouveaux réglages et préserve les passages existants tant que les durées ne sont pas validées. Elle retire des entrées de journal anciennes les noms recopiés lors de corrections d’appel ou de prolongations. Vérifiez ensuite les comptes, nommez les agents autorisés à activer la borne et validez la purge. Le planning sans connexion est fermé par défaut.

Si vous restaurez directement un volume ou un dossier SQLite (au lieu de la restauration dans TiceCDI), gardez l’instance hors accès usagers et importez l’état de reprise courant avant de rouvrir. La rotation gérée par TiceCDI concerne ses copies locales. Les autres sauvegardes et leurs durées relèvent de l’établissement.
