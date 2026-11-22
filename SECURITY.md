# Sécurité de TiceCDI

## Signaler une vulnérabilité

N’ouvrez pas d’issue publique. Utilisez **Security → Report a vulnerability** sur le dépôt GitHub ou contactez directement l’auteur. Décrivez la version, l’édition (PHP ou Docker) et les étapes pour reproduire.

## Protections intégrées

| Domaine | Mesure |
| --- | --- |
| Comptes | Comptes nominatifs, droits par rubrique, au moins un administrateur conservé. Mot de passe de 12 caractères minimum. |
| Mots de passe | PBKDF2-SHA256 à 600 000 itérations avec sel aléatoire. Anciennes empreintes converties à la connexion. Comparaison à temps constant, même pour un identifiant inconnu. |
| Sessions | Jeton aléatoire de 256 bits stocké haché, cookie `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS, durée de 12 heures. Sessions fermées au changement de mot de passe. |
| Tentatives | Limitation par poste (30 essais / 10 min) et par identifiant (12 essais / 10 min), clé d’installation limitée elle aussi. |
| Requêtes | Contrôle d’origine et de `Sec-Fetch-Site` sur les écritures, corps JSON obligatoire, tailles bornées, requêtes SQL paramétrées. |
| En-têtes | CSP sans script en ligne, `X-Frame-Options`, `Permissions-Policy`, COOP/CORP, `nosniff`, `X-Robots-Tag: noindex`, HSTS en HTTPS. |
| Borne | Poste activé par un membre du personnel (cookie dédié de 12 heures), révocable à tout moment. |
| Données | Base SQLite hors de la racine web, dossier en `0700`, sauvegardes chiffrées (AES-GCM), purge automatique et journal des modifications. |
| Docker | Utilisateur non-root, code en lecture seule, aucun gestionnaire de paquets JavaScript, système de fichiers en lecture seule, aucune capacité Linux. |

## Check-list de mise en production

1. **HTTPS obligatoire.** Placez TiceCDI derrière un reverse proxy HTTPS (Nginx Proxy Manager, Traefik, Caddy, Apache…) et renseignez `CDI_ORIGIN` avec l’adresse exacte, par exemple `https://cdi.exemple.fr`.
2. **Reverse proxy.** Mettez `CDI_TRUST_PROXY=1` uniquement si TiceCDI n’est joignable **que** par ce proxy. Gardez sinon la valeur `0`, car un client pourrait falsifier `X-Forwarded-For`.
3. **Exposition réseau.** Laissez `CDI_BIND_IP=127.0.0.1` quand le proxy est sur la même machine. N’ouvrez pas le port 8080 sur Internet.
4. **Accès réduit.** Si possible, limitez `/gestion` au réseau de l’établissement ou à un VPN au niveau du proxy.
5. **Clé d’installation.** Créez le compte administrateur dès le premier démarrage, puis supprimez `installation.key` ou la variable `CDI_SETUP_KEY`.
6. **Mises à jour.** Suivez les releases GitHub et mettez à jour l’image ou l’archive PHP. Pour PHP, utilisez une version maintenue (8.3 ou plus).
7. **Sauvegardes.** Testez la restauration chiffrée et conservez la phrase secrète à part.
