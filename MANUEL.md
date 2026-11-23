# Manuel TiceCDI

Présences, planning et fréquentation du CDI · Une application de TiceConnect

## 1. Mettre en service

Le menu de gestion est regroupé en sections (**Au quotidien**, **Élèves et classes**, **Borne**, **Administration**, **Mon compte**) que l’on replie d’un clic ; le choix est mémorisé sur le navigateur. Le site occupe toute la largeur de l’écran.

Suivez le [guide PHP](docs/INSTALLATION-PHP.md) ou le [guide Docker et Portainer](docs/INSTALLATION-PORTAINER.md). Au premier démarrage, créez un compte administrateur nominatif avec la clé d’installation générée localement. Attribuez un compte nominatif à chaque agent et les seuls droits utiles à ses missions. Avant l’ouverture, suivez la [check-list de sécurité](SECURITY.md#check-list-de-mise-en-production) : HTTPS, adresse publique dans `CDI_ORIGIN` et accès à la gestion limité au réseau de l’établissement.

Dans **Établissement et données personnelles**, renseignez l’identité et le contact de l’établissement, le contact du DPD, la finalité, la base légale, la source, les destinataires, l’hébergement, les durées et les modalités d’exercice des droits. Vérifiez les trois documents avant diffusion. La notice courte est accessible depuis la borne et la notice complète peut être téléchargée pour l’ENT. La fiche de registre est un modèle à valider et compléter localement.

Pour un traitement mis en œuvre localement dans un collège ou lycée public, le chef d’établissement assure la responsabilité du traitement local. L’établissement détermine la base légale, les habilitations, les durées et l’hébergement avec l’appui du DPD. Il documente son évaluation du besoin d’analyse d’impact en fonction de l’usage prévu et réalise l’AIPD lorsque le traitement présente un risque élevé. La fin de journée proposée par le logiciel est un **choix de configuration**. L’appel scolaire officiel suit les procédures de l’établissement.

[Éducation nationale – protection des données personnelles](https://www.education.gouv.fr/la-protection-des-donnees-personnelles-1421) · [CNIL – déterminer le besoin d’AIPD](https://www.cnil.fr/sites/cnil/files/atoms/files/infographie_aipd.pdf)

## 2. Borne et accès du personnel

| Habilitation | Peut effectuer |
| --- | --- |
| Vie scolaire | Consulter les présences, selon le droit attribué. |
| Personnel du CDI | Consulter et gérer les présences et prolongations selon ses droits. |
| Activer un poste | Ouvrir une borne de pointage sur un navigateur dédié (durée fixée par l’administrateur). |
| Exporter (par rubrique) | Planning en PDF, fiches d’appel en CSV, statistiques, dossier individuel. Exige aussi de consulter la rubrique. |
| Sauvegardes | Créer et télécharger les sauvegardes chiffrées (droit distinct des exports). |
| Restaurer | Analyser et appliquer une sauvegarde ou un état de reprise. |
| Dossiers individuels | Consulter, rectifier ou effacer (droit séparé) un dossier sur demande validée. |
| Administrateur | Configurer l’établissement et les droits, accéder au journal et exécuter les opérations d’administration. |

Dans **Comptes et droits**, chaque rubrique se règle sur **Aucun**, **Consulter** ou **Gérer** : planning, fiches d’appel, exclusions, élèves, classes, groupes, réglages et horaires de la borne. « Consulter » ouvre la page en lecture seule (badge « Consultation seule », boutons de modification masqués et refusés par le serveur). Les actions sensibles (import, codes-barres, activation de borne, exports, restauration, dossiers individuels, gestion des comptes) se cochent à part, comme le journal et les statistiques. La colonne **Exporter** autorise les PDF et CSV d’une rubrique (planning, fiches d’appel, statistiques, dossiers individuels) ; elle ne donne jamais accès aux sauvegardes complètes, qui ont leurs propres cases (créer et télécharger, restaurer). Les dossiers individuels distinguent consulter, rectifier et effacer. Des modèles remplissent le tableau en un clic : vie scolaire, enseignant, direction (consultation complète), personnel du CDI, référent données. Un agent qui gère les comptes sans être administrateur ne peut attribuer que les droits qu’il possède.

Sur le poste dédié, ouvrez **Borne → Postes de borne**, choisissez **Activer ce poste**, donnez-lui un nom (par exemple « Borne accueil ») et confirmez. La session du personnel se ferme et la borne s’ouvre. Une restauration révoque les activations en cours. Les agents chargés de la seule consultation disposent de leur propre accès dans **Présences**.

L’administrateur choisit sur la même page la **durée d’activation** (12 heures, 7 jours, 30 jours ou jusqu’au 31 août) et le **renouvellement automatique** : une borne qui sert régulièrement est alors prolongée d’elle-même et n’a plus à être réactivée ; une borne éteinte plus longtemps que la durée choisie expire. Par défaut : 30 jours, renouvelés à l’usage. La liste des postes indique qui les a activés, leur dernière activité et leur validité ; **Révoquer** désactive un seul poste, **Révoquer tous les postes** les désactive tous.

Sur la borne, l’élève tape son nom ou son prénom dans le champ unique : dès 2 lettres, les élèves correspondants s’affichent (prénom, initiale du nom et classe, 6 au plus), les plus proches en premier. Les mots se tapent dans n’importe quel ordre (« martin lina »), un mot peut désigner la classe (« lina 2nde3 ») et, si rien ne correspond exactement, la borne propose les noms proches (une ou deux fautes de frappe). **Toucher son nom enregistre l’entrée immédiatement** ; le bouton **Sortir** à côté du nom enregistre la sortie. Avec une carte CDI, l’élève la scanne (douchette Code 128 en mode clavier, ou code tapé) : il est **enregistré automatiquement**, en entrée au premier passage et en sortie au suivant. Un double scan dans les 10 secondes est ignoré. La borne affiche l’état du CDI (ouvert, fermé, places libres), efface la saisie après chaque pointage et ne montre ni annuaire ni liste des présents. Elle ne contient aucun lien vers l’espace du personnel ni vers la notice (accessible depuis l’ENT et la page d’accueil). La recherche par nom se désactive dans **Postes de borne** (la borne n’accepte alors que les cartes).

### En direct, alertes et arrivée manuelle

La page **En direct** résume la situation du CDI (présents, places, état de la borne, arrivées et départs proches, classes, planning du jour, alertes) et s’actualise seule. Dans **Présences**, la colonne **Motif** indique pourquoi l’élève est au CDI (cliquez pour le choisir ou le modifier). La cloche de l’en-tête signale un élève exclu qui tente d’entrer, un CDI presque plein ou complet ; **Alertes du navigateur** affiche aussi une notification système. **Ajouter un élève** (Présences ou En direct) enregistre, avec un motif facultatif, l’arrivée d’un élève sans carte, même hors horaires, sauf s’il est exclu ou si le CDI est complet.

### Accès des élèves pendant un créneau

Dans le planning, chaque créneau porte la case **Accepter les élèves au CDI pendant ce créneau**. Décochée, la borne refuse les entrées pendant la plage (les sorties restent possibles) et le créneau affiche « Borne fermée aux élèves ». Une fermeture exceptionnelle refuse toujours les élèves. L’arrivée groupée d’une classe par le personnel reste possible.

### Affichage de la borne

Dans **Réglages et horaires → Affichage de la borne** : places libres en grand (avec une capacité renseignée), planning du jour, animation de lecture, durée de la confirmation plein écran, annonces en couleur (six au maximum, à tour de rôle), règles du CDI (une par ligne), écran de repos (délai de 30 secondes à 10 minutes) et thème (clair, sombre ou sombre entre deux heures). Les changements s’appliquent sur la borne en quelques secondes, sans la recharger.

### Installer la borne comme application

En HTTPS, la borne peut être installée comme une application : après l’activation du poste, utilisez le menu du navigateur **Installer l’application** (Chrome, Edge). Elle s’ouvre alors en plein écran sur la page de pointage, garde l’écran allumé et affiche un bandeau si le réseau tombe. Si le serveur redémarre, une page **Connexion au serveur perdue** s’affiche et la borne revient seule dès que le service répond. Elle se recharge chaque nuit vers 4 h pour appliquer les mises à jour.

### Douchette et cartes

La borne accepte une douchette Code 128 en mode clavier, même réglée en QWERTY sur un poste AZERTY (chiffres tapés « & é " ' ( … ») et même avec un préfixe d’identification (`]C0`) ou le verrouillage majuscule. Les cartes s’impriment trois par ligne, le code-barres occupant toute la largeur de la carte. Si une carte reste illisible, réimprimez-la depuis **Cartes codes-barres** à 100 % (sans « ajuster à la page »).

### Sécurité du compte

Chaque agent dispose de la rubrique **Sécurité du compte** :

1. **Activer la double authentification** : saisissez votre mot de passe, scannez le QR code avec une application d’authentification (Microsoft Authenticator, Google Authenticator, FreeOTP, Aegis…) puis entrez le code à 6 chiffres affiché.
2. **Conservez les dix codes de secours** (copie ou téléchargement). Chacun ne sert qu’une fois et remplace le téléphone en cas de perte. **Nouveaux codes de secours** invalide les anciens.
3. À la connexion suivante, TiceCDI demande le code de l’application après le mot de passe. Un code de secours s’écrit sous la forme `xxxx-xxxx`.
4. **Mes sessions ouvertes** liste les navigateurs connectés à votre compte : fermez une session inconnue ou **Fermez les autres sessions**.

Un administrateur voit les sessions de tous les comptes et peut les fermer. Si un agent perd son téléphone et ses codes, l’administrateur choisit **Réinitialiser la 2FA** dans **Comptes et droits** : l’agent se reconnecte avec son mot de passe puis réactive la double authentification.

### Connexion et sécurité (administrateurs)

- **Double authentification** : facultative, obligatoire pour les administrateurs ou pour tous. Un compte concerné qui ne l’a pas encore ne voit que **Sécurité du compte** jusqu’à son activation.
- **Déconnexion après inactivité** : 60 minutes par défaut (0 pour désactiver). Une page laissée ouverte qui s’actualise seule ne prolonge pas la session.
- **Seuil d’alerte** : au-delà de ce nombre d’échecs de connexion en 24 heures pour un même compte, un encart prévient les administrateurs.
- **Connexion par l’ENT** : choisissez CAS (adresse du serveur CAS, par exemple `https://cas.ent.exemple.fr/cas`) ou OpenID Connect (émetteur, identifiant et secret client, champ portant l’identifiant). Déclarez auprès de l’ENT l’**adresse de retour** affichée sur la page, puis utilisez **Tester les réglages enregistrés**. L’identifiant de l’ENT doit être identique à l’identifiant du compte TiceCDI : créez les comptes avec les identifiants ENT du personnel.

Le bouton lune/soleil de l’en-tête bascule entre thème clair et sombre. Sans choix, TiceCDI suit le réglage du système.

## 3. Présences, planning et appel interne

Un pointage à 8 h 30 expire à 9 h. L’option deuxième heure, si l’établissement l’autorise, ou la prolongation d’un créneau par le personnel, porte cette échéance à 10 h. La liste des présents se recalcule côté serveur. Dans le dossier individuel, **Créneau expiré** désigne une échéance atteinte. **Sortie enregistrée** désigne une action de sortie.

Dans **Présences → Arrivée groupée**, sélectionnez une classe ou un groupe et décochez les élèves absents. La fiche d’appel sert à la gestion interne du CDI. Le personnel peut rectifier le statut, fermer une séance ou garder certains élèves au CDI. L’impression des cartes et l’export de l’appel exigent l’habilitation d’export.

Dans **Planning du CDI**, configurez les horaires et ajoutez une réservation, un cours ou une fermeture. Déplacez le créneau à la souris ou ouvrez son formulaire au clavier pour changer ses heures. Un agent habilité peut exporter le PDF du jour ou de la semaine. Les horaires ouverts, fermés et réservés sont également présentés dans **Version tableau du planning**. Pour activer l’écran sans connexion, utilisez le réglage de confidentialité. Le public reçoit uniquement les horaires et ces statuts. Les titres, affectations, notes et jauges sont réservés aux vues habilitées.

La borne, les formulaires et le planning proposent des libellés explicites, un focus visible, des commandes au clavier et des états exprimés en texte. Toute déclaration de conformité RGAA repose sur une évaluation effective de l’instance. [Évaluer et déclarer l’accessibilité](https://accessibilite.numerique.gouv.fr/obligations/evaluation-conformite/)

## 4. Import et droits individuels

**Supprimer une classe** : si elle contient des élèves, choisissez la classe qui les accueillera (les fiches retirées suivent). Une classe sans élève actif se supprime directement et ses fiches retirées sont rangées dans « Anciens élèves ».

**Pronote** : exportez la liste des élèves en CSV (colonnes Nom, Prénom et Classe, ou Élève au format NOM Prénom). **SIECLE** : importez directement `ElevesSansAdresses.xml` depuis l’export « Base élèves » ; la division devient la classe, les élèves sortis sont ignorés et l’identifiant SIECLE permet de suivre un élève qui change de classe à la rentrée. Le fichier XML est lu dans le navigateur : seuls le nom, le prénom, la classe et l’identifiant sont envoyés au serveur.

Préparez un CSV avec `Nom`, `Prénom`, `Classe` et, si nécessaire, `Identifiant interne` stable pour les homonymes et les réimports. Le navigateur extrait ces champs, ignore les autres colonnes et transmet les seules valeurs retenues. Le serveur ne reçoit pas le fichier brut. Pour un passage d’année, l’identifiant interne doit être renseigné de manière stable. Conservez les documents d’origine selon les règles de votre établissement.

Dans **Dossiers individuels**, recherchez l’élève puis ouvrez son dossier. La vue distingue l’annuaire, les passages conservés, les appels internes, les exclusions et les éventuelles archives. Rectifiez les données d’identité ou utilisez l’export ciblé selon vos droits. L’effacement demande une confirmation explicite. Il supprime les données nominatives associées, invalide les anciennes copies locales de sauvegarde et enregistre un identifiant technique dans l’état de reprise pour empêcher une réapparition. Les agrégats de fréquentation sont conservés.

## 5. Purge, statistiques et journal

Les **Statistiques** affichent toutes les valeurs, même les plus petites : passages, élèves différents, moyenne par jour d’ouverture, durée moyenne, heures cumulées, pic de présence simultanée, part des venues avec la classe ou un groupe, sorties avant l’échéance, évolution par rapport à la période précédente et journée la plus chargée. S’y ajoutent le taux de fréquentation (élèves venus / élèves inscrits), le nombre de classes venues, le jour le plus fréquenté et l’heure de pointe. Les graphiques sont regroupés en quatre parties : **Évolution** (passages par jour ou par semaine, par mois), **Moments de fréquentation** (moyenne par jour de la semaine, arrivées par heure, affluence jour × heure avec totaux), **Publics** (passages et taux de venue par niveau, classes les plus présentes, assiduité) et **Modalités de venue** (type de venue, durée de présence), puis le détail de toutes les classes. Le niveau (6e … Terminale, BTS, CAP…) est déduit du nom de la classe. Depuis la v1.12, la purge conserve aussi ces répartitions en compteurs anonymes par jour (heure d’arrivée, durée, type de venue, classe) : l’affluence et le détail restent complets après la purge de fin de journée. Seuls l’assiduité et le nombre exact d’élèves différents demandent les passages nominatifs ; pour les jours archivés, le nombre d’élèves est un minimum (« ≥ »). **Rapport PDF** (synthèse, moments, publics, puis toutes les classes sans troncature) et **Exporter en CSV** reprennent l’ensemble.

Le réglage **0 jour supplémentaire** conserve les passages jusqu’à la fin de leur journée (heure de Paris). Un créneau encore actif est conservé jusqu’à son échéance. Les fiches d’appel, les archives nominatives des années closes et les exclusions échues suivent aussi la purge configurée. L’annuaire des élèves en activité sert aux pointages et se gère séparément.

La tâche enregistre les totaux journaliers et les répartitions agrégées (heure, durée, type de venue, classe) avant de retirer le nominatif. Les statistiques ne présentent aucun classement nominatif d’élèves ; le détail par classe et les petits effectifs sont affichés, l’accès est donc réservé aux comptes disposant du droit « Statistiques ». Pensez-y en attribuant ce droit.

Sous Docker la tâche tourne au démarrage puis toutes les minutes. Sous PHP programmez [la tâche CLI](docs/INSTALLATION-PHP.md#programmer-la-purge). Le tableau de bord affiche le dernier succès. Le journal consigne les changements de droits, les échecs de connexion et les opérations de double authentification (rubrique **Sécurité des comptes**), les opérations d’export, les restaurations et les effacements, avec une durée dédiée. Réservez les champs libres du planning et le message de la borne aux informations de service.

## 6. Sauvegardes et restauration

Dans **Sauvegarde et restauration**, créez une sauvegarde chiffrée avec une phrase secrète et conservez-la séparément dans les outils internes autorisés. Les archives locales sont limitées en nombre et expirent selon les réglages lorsque la purge est active. L’export et la restauration sont des habilitations distinctes. Les comptes et les réglages de confidentialité sont gérés sur l’instance d’accueil.

Pour restaurer, sélectionnez le fichier et analysez-le avant confirmation. Avant de rendre la restauration visible, l’application réapplique les purges et les effacements connus, et conserve les événements d’administration encore valides. Une sauvegarde historique JSON en clair peut être reprise. Protégez-la comme toute copie nominative.

Après un effacement validé et avant toute sauvegarde d’infrastructure, utilisez **Exporter l’état de reprise**. Conservez ce petit fichier chiffré, mis à jour, séparément du stockage de l’application. En cas de perte du volume, préparez le serveur hors accès usagers, saisissez les durées validées, importez l’état de reprise le plus récent avec **Importer l’état de reprise**, puis restaurez la sauvegarde. Si l’état à jour a été perdu, l’établissement doit reconstituer les demandes validées avant de rouvrir. Un ancien fichier ne contient que les décisions connues à sa date.

## 7. Mettre à jour une installation existante

Faites une sauvegarde hors accès usagers. Gardez le dossier de données PHP, le chemin d’installation, les variables et la même stack Docker avec le volume `cdi_data`. La migration ajoute les nouveaux réglages et préserve les passages existants tant que les durées ne sont pas validées. Elle retire des entrées de journal anciennes les noms recopiés lors de corrections d’appel ou de prolongations. Vérifiez ensuite les comptes, nommez les agents autorisés à activer la borne et validez la purge. Le planning sans connexion est fermé par défaut.

Si vous restaurez directement un volume ou un dossier SQLite (au lieu de la restauration dans TiceCDI), gardez l’instance hors accès usagers et importez l’état de reprise courant avant de rouvrir. La rotation gérée par TiceCDI concerne ses copies locales. Les autres sauvegardes et leurs durées relèvent de l’établissement.
