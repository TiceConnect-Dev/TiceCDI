# Journal des versions

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
