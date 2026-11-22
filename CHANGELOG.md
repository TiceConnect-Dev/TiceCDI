# Journal des versions

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
