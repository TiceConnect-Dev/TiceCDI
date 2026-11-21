# Installer Gestion du CDI dans Portainer

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
| `CDI_IMAGE_TAG` | `latest` | Indique `v1.1.0` si tu veux épingler cette version. |
| `CDI_PULL_POLICY` | `missing` | Mets `never` pour utiliser une image importée localement. |

4. Clique sur **Deploy the stack**. Dans **Containers**, vérifie que le conteneur a démarré, puis ouvre ses journaux pour lire la clé de première configuration.
5. Depuis un poste autorisé, ouvre `http://IP_DU_SERVEUR:8080/gestion` avec le port choisi et crée le compte administrateur. La borne est à `/borne` et l’écran de planning à `/planning-ecran`.

Garde la borne sur le réseau de l’établissement. Pour un reverse proxy en conteneur, configure un réseau Docker partagé et fais pointer le proxy vers le service CDI sur le port **8080**. Définis `CDI_ORIGIN` sur l’URL HTTPS utilisée par le navigateur.

## Importer l’image depuis un fichier

1. Télécharge [Gestion-CDI-Docker-amd64.tar.gz](https://github.com/Xeros59/Gestion-CDI/releases/latest/download/Gestion-CDI-Docker-amd64.tar.gz) depuis la release GitHub.
2. Dans Portainer, ouvre **Images → Import**, sélectionne le fichier et clique sur **Upload**. En SSH sur l’hôte Docker, la commande équivalente est `docker load -i Gestion-CDI-Docker-amd64.tar.gz`.
3. Déploie la même stack avec `CDI_PULL_POLICY=never`. Portainer utilisera le tag importé sur l’hôte.

## Mettre à jour ou reprendre un CDI existant

1. Télécharge une sauvegarde du CDI et conserve le volume d’origine.
2. Pour passer de l’ancien `build: .` à l’image publiée, modifie **la même stack** en gardant le montage `cdi_data:/data`. Si tu changes de nom de stack, Docker utilise par défaut un autre volume.
3. Pour mettre à jour, importe le nouveau fichier dans **Images** et actualise la stack. Si tu utilises le registre, demande le téléchargement de la nouvelle image depuis Portainer.
4. Ouvre `/healthz` et vérifie la connexion administrateur, les élèves et le planning.

Pour vérifier le fichier téléchargé sous Linux, télécharge `SHA256SUMS.txt` depuis la même release, puis utilise `sha256sum -c SHA256SUMS.txt --ignore-missing` dans le dossier du téléchargement.

[Documentation Portainer — Importer une image](https://docs.portainer.io/user/docker/images/import).
