# Journal des versions

## v1.7.0 · Nouvelle borne, recherche par nom et suppression de classe

**Borne élèves**

- Nouvelle page plein écran, plus grande et plus lisible : horloge, état du CDI (ouvert, fermé, places libres), grand champ de saisie, gros boutons Entrée et Sortie, messages de confirmation bien visibles.
- Le code de la carte s’affiche en clair pendant la saisie (plus de points masqués).
- Plus de liens « Données personnelles » ni « Espace personnel » dans l’en-tête : la borne ne montre que le pointage. Un petit lien « Protection des données » reste en pied de page pour l’information des élèves (RGPD).
- **Recherche par nom pour les élèves sans carte** : « Pas de carte ? Cherche ton nom », 3 lettres minimum, au plus 6 résultats affichés en « Prénom N. · classe ». La sélection est valable 3 minutes sur ce seul poste ; le code de la carte n’est jamais envoyé au navigateur. Désactivable dans **Postes de borne**.

**Classes**

- Supprimer une classe qui contient des élèves propose de les déplacer vers une autre classe (fiches retirées comprises). Une classe sans élève actif se supprime directement : ses fiches retirées rejoignent la classe « Anciens élèves ».

La migration `0008_kiosk_search.sql` s’applique seule.

## v1.6.0 · Postes de borne, pleine largeur et menu regroupé

**Borne**

- Durée d’activation réglable par l’administrateur : 12 heures, 7 jours, 30 jours ou jusqu’à la fin de l’année scolaire (31 août). **Par défaut : 30 jours.**
- Renouvellement automatique (activé par défaut) : une borne utilisée régulièrement est prolongée d’elle-même et n’a plus besoin d’être réactivée.
- Nouvelle page **Postes de borne** : nom du poste à l’activation, liste des postes (activé par, date, dernière activité, navigateur et poste, validité) et révocation poste par poste.

**Interface**

- Le site occupe toute la largeur de l’écran (les pages de connexion et de borne restent centrées).
- Menu de gestion regroupé en sections repliables (Au quotidien, Élèves et classes, Borne, Administration, Mon compte), libellés raccourcis, état mémorisé. Sur téléphone, toutes les rubriques restent dans le bandeau défilant.

La migration `0007_kiosk_devices.sql` s’applique seule. Les postes déjà activés passent au renouvellement automatique dès leur prochaine utilisation.

## v1.5.0 · Connexion ENT, règles de connexion, statistiques, imports et caméra

**Connexion et sécurité** (nouvelle rubrique réservée aux administrateurs)

- Connexion par l’ENT : CAS (ENT académiques, Skolengo, Atrium…) ou OpenID Connect avec PKCE. Bouton « Se connecter avec … » sur la page de connexion. L’identifiant renvoyé par l’ENT doit correspondre à un compte TiceCDI existant ; aucun compte n’est créé automatiquement. Si le compte a la double authentification, le code est demandé au retour de l’ENT.
- Double authentification exigée au choix : facultative, obligatoire pour les administrateurs ou pour tous. Un compte concerné ne voit plus que « Sécurité du compte » tant qu’elle n’est pas activée.
- Déconnexion après inactivité (60 min par défaut, réglable, 0 pour désactiver). Les actualisations automatiques de la page Présences ne comptent pas comme activité.
- Encart d’alerte pour les administrateurs quand un compte dépasse un seuil d’échecs de connexion sur 24 h (5 par défaut).

**Statistiques**

- Moyenne des passages par jour de la semaine et carte d’affluence jour × heure (cases de moins de 5 passages masquées).
- Rapport PDF de fréquentation (synthèse, passages par jour, moyennes, affluence) pour le conseil pédagogique ou le rapport d’activité.

**Import des élèves**

- Exports Pronote reconnus, y compris la colonne « Élève » au format NOM Prénom et une ligne de titre avant l’en-tête.
- SIECLE : import direct du fichier `ElevesSansAdresses.xml` (division comme classe, élèves sortis ignorés, identifiant SIECLE conservé) ou d’un CSV avec la colonne Division. Le format reconnu est indiqué à la vérification.

**Borne et écran**

- Scan de la carte par la caméra (bouton « Scanner avec la caméra », HTTPS requis), avec le détecteur du navigateur ou un décodeur Code 128 intégré.
- L’écran de planning public affiche les places libres en temps réel (ou le nombre d’élèves présents sans capacité définie).

La migration `0006_connection_settings.sql` s’applique seule. Après la mise à jour, la déconnexion après 60 minutes d’inactivité est active : ajustez-la dans **Connexion et sécurité**.

## v1.4.0 · Double authentification, sessions, thème sombre et borne installable

**Sécurité des comptes**

- Double authentification par code à 6 chiffres (TOTP, compatible Microsoft Authenticator, Google Authenticator, FreeOTP, Aegis…). Activation par QR code généré dans le navigateur, sans service externe.
- Dix codes de secours à usage unique, à copier ou télécharger, régénérables à tout moment. Un code déjà utilisé ne peut pas être rejoué.
- Un administrateur peut réinitialiser la double authentification d’un agent qui a perdu son téléphone (ses sessions sont alors fermées).
- Nouvelle page **Sécurité du compte** pour chaque agent : sessions ouvertes (navigateur, poste, ouverture, dernière activité), fermeture d’une session ou de toutes les autres. Les administrateurs voient et ferment les sessions de tous les comptes.
- Le journal, rubrique **Sécurité des comptes**, trace les échecs de connexion et de double authentification (poste et navigateur), les connexions par code de secours, les activations, désactivations, réinitialisations et fermetures de sessions.
- Colonne « Double authentification » dans **Comptes et droits**.

**Interface**

- Thème sombre automatique (selon le système) ou au choix via le bouton lune/soleil de l’en-tête, mémorisé par navigateur. Cartes CDI et QR codes restent sur fond clair.
- Borne installable comme application (PWA) : bouton **Installer la borne**, ouverture en plein écran, écran maintenu allumé, bandeau en cas de coupure réseau, page de reconnexion automatique si le serveur redémarre et rechargement chaque nuit pour appliquer les mises à jour.
- La case « deuxième heure » de la borne n’est plus collée au champ du code-barres.

La migration `0005_account_security.sql` s’applique seule au démarrage. Aucune action n’est requise : la double authentification reste facultative.

## v1.3.0 · Affichage et sécurité

**Affichage**

- Les en-têtes des tableaux (présences, élèves, classes, exclusions, comptes, codes-barres, journal) ne sont plus collés au bord des panneaux : marges, séparation et alignement des filtres.
- Sur téléphone, le contenu ne déborde plus de l’écran : le planning et les tableaux défilent dans leur cadre.
- Sur téléphone, le menu de gestion devient un bandeau horizontal défilant et l’en-tête n’affiche plus que des icônes (libellés conservés pour les lecteurs d’écran).
- La barre latérale défile seule lorsqu’elle dépasse la hauteur de l’écran.
- La barre d’outils du planning passe à la ligne par groupes de boutons.
- La colonne « Code CDI », toujours vide dans l’annuaire des élèves, est retirée : les codes restent réservés à la planche des codes-barres.

**Sécurité**

- Mots de passe hachés en PBKDF2-SHA256 à 600 000 itérations. Les anciennes empreintes sont converties automatiquement à la connexion suivante, sans action des utilisateurs.
- En-têtes de sécurité sur toutes les réponses : `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-Robots-Tag`, CSP stricte pour l’API et `Strict-Transport-Security` en HTTPS.
- Méthodes HTTP limitées à GET, HEAD, POST, PATCH et DELETE. Adresses trop longues refusées.
- Délais de connexion bornés sur l’édition Docker contre les connexions lentes.
- Nouvelle variable `CDI_TRUST_PROXY=1` derrière un reverse proxy de confiance : la limitation des tentatives de connexion s’applique alors à l’adresse réelle de chaque poste.
- Image Docker allégée (npm, npx, yarn et corepack retirés), code en lecture seule, `HEALTHCHECK` intégré.
- Stacks Docker durcies : système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`, limites de mémoire et de processus.
- Édition PHP : `.htaccess` renforcé (pas de liste de dossiers, fichiers cachés et sensibles refusés, en-têtes de sécurité, méthodes limitées) et exemple de configuration Nginx dans le guide.

La mise à jour conserve les comptes et les données. Voir [SECURITY.md](SECURITY.md) pour la liste des protections et les recommandations de déploiement.

## v1.2.0

- Publication de TiceCDI (édition PHP et image Docker) et réglages de protection des données.
