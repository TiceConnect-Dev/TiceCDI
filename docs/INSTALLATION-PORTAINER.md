# Installer TiceCDI dans Portainer

L’image utilise l’édition Docker du CDI, avec Node.js et SQLite inclus. Le volume `cdi_data` conserve la base lors des redémarrages et des mises à jour. L’image distribuée est prévue pour **Linux amd64**.

## Déployer depuis le registre GitHub

1. Dans ton environnement Portainer **Docker Standalone**, ouvre **Stacks → Add stack**.
2. Choisis un nom, par exemple `gestion-cdi`. Colle le contenu de [compose.portainer.yaml](../compose.portainer.yaml) dans **Web editor**. La stack utilise l’image publique `ghcr.io/xeros59/gestion-cdi:latest`.
3. Ajoute les variables dont tu as besoin dans **Environment variables**.

| Variable | Valeur par défaut | Usage |
| --- | --- | --- |
| `CDI_PORT` | `8080` | Port publié par le serveur. Prends un autre port si celui-ci est déjà utilisé. |
| `CDI_BIND_IP` | `127.0.0.1` | Pour la borne sur le réseau local, mets l’adresse IP interne du serveur. |
| `CDI_ORIGIN` | Vide | Derrière un reverse proxy, indique l’origine externe exacte, sans chemin ni barre oblique finale. |
| `CDI_TRUST_PROXY` | `0` | Mets `1` uniquement si le conteneur n’est joignable que par ton reverse proxy. Les tentatives de connexion sont alors comptées par poste réel. |
| `CDI_IMAGE_TAG` | `latest` | Indique `v1.11.0` si tu veux épingler cette version. |
| `CDI_PULL_POLICY` | `missing` | Mets `never` pour utiliser une image importée localement. |

4. Clique sur **Deploy the stack**. Dans **Containers**, vérifie que le conteneur a démarré, puis ouvre ses journaux pour lire la clé de première configuration.
5. Depuis un poste autorisé, ouvre `http://IP_DU_SERVEUR:8080/gestion` avec le port choisi et crée le compte administrateur. Active le poste dédié via **Borne → Postes de borne**. L’écran de planning à `/planning-ecran` s’ouvre quand l’affichage public est autorisé.

Déploie TiceCDI en HTTPS sur une infrastructure autorisée par l’établissement. Pour un reverse proxy en conteneur, configure un réseau Docker partagé et fais pointer le proxy vers le service CDI sur le port **8080**. Définis `CDI_ORIGIN` sur l’URL HTTPS utilisée par le navigateur et `CDI_TRUST_PROXY=1`.

## Durcissement inclus dans la stack

La stack fournie applique déjà les protections suivantes. Garde-les si tu adaptes le fichier.

| Réglage | Effet |
| --- | --- |
| `read_only: true` et `tmpfs: /tmp` | Le conteneur ne peut écrire que dans le volume `cdi_data` et un `/tmp` temporaire. |
| `cap_drop: ALL` | Aucune capacité Linux n’est accordée au processus. |
| `security_opt: no-new-privileges:true` | Aucune élévation de privilèges possible dans le conteneur. |
| `pids_limit` et `mem_limit` | Limite les processus (128) et la mémoire (512 Mo). |
| Image | Utilisateur `node` non-root, code en lecture seule, npm et yarn retirés, `HEALTHCHECK` intégré. |

Ne publie pas le port 8080 directement sur Internet : laisse `CDI_BIND_IP=127.0.0.1` quand le proxy tourne sur le même hôte, ou n’expose le service que sur le réseau Docker du proxy. Après la création du compte administrateur, la clé de première configuration ne sert plus. Voir aussi [SECURITY.md](../SECURITY.md).

## Importer l’image depuis un fichier

1. Télécharge [TiceCDI-Docker-amd64.tar.gz](https://github.com/Xeros59/TiceCDI/releases/latest/download/TiceCDI-Docker-amd64.tar.gz) depuis la release GitHub.
2. Dans Portainer, ouvre **Images → Import**, sélectionne le fichier et clique sur **Upload**. En SSH sur l’hôte Docker, la commande équivalente est `docker load -i TiceCDI-Docker-amd64.tar.gz`.
3. Déploie la même stack avec `CDI_PULL_POLICY=never`. Portainer utilisera le tag importé sur l’hôte.

## Mettre à jour ou reprendre un CDI existant

1. Télécharge une sauvegarde chiffrée et l’état de reprise actualisé depuis TiceCDI. Conserve le volume d’origine.
2. Pour passer de l’ancien `build: .` à l’image publiée, modifie **la même stack** en gardant le montage `cdi_data:/data`. Si tu changes de nom de stack, Docker utilise par défaut un autre volume.
3. Pour mettre à jour, importe le nouveau fichier dans **Images** et actualise la stack. Si tu utilises le registre, active **Re-pull image** lors de la mise à jour de la stack. Depuis une version antérieure à la v1.3.0, recopie aussi le nouveau contenu de `compose.portainer.yaml` afin de récupérer le durcissement, en gardant le même nom de stack.
4. Ouvre `/healthz` et vérifie la connexion administrateur, les données et le planning. Renseigne les paramètres dans **Établissement et données personnelles**.
5. Sous Docker la purge démarre automatiquement. Une base migrée conserve son historique tant que l’administrateur n’a pas validé et activé la purge. Vérifie son dernier passage réussi.

Pour vérifier le fichier téléchargé sous Linux, télécharge `SHA256SUMS.txt` depuis la même release, puis utilise `sha256sum -c SHA256SUMS.txt --ignore-missing` dans le dossier du téléchargement.

[Documentation Portainer — Importer une image](https://docs.portainer.io/user/docker/images/import).
