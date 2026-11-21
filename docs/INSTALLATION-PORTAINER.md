# Installer Gestion du CDI dans Portainer

L’image utilise l’édition Docker du CDI, avec Node.js et SQLite inclus. Le volume `cdi_data` conserve la base lors des redémarrages et des mises à jour. L’image distribuée est prévue pour **Linux amd64**.

## Utiliser l’image dans une stack

1. Dans Portainer, choisis ton environnement Docker, puis **Stacks → Add stack**.
2. Donne un nom à la stack, par exemple `gestion-cdi`.
3. Dans **Web editor**, colle le contenu de [compose.portainer.yaml](../compose.portainer.yaml). La ligne `image` utilise `ghcr.io/xeros59/gestion-cdi:latest`.
4. Ajoute les variables dont tu as besoin dans **Environment variables**.

| Variable | Valeur par défaut | Usage |
| --- | --- | --- |
| `CDI_PORT` | `8080` | Port publié par le serveur. Prends un autre port si celui-ci est déjà utilisé. |
| `CDI_BIND_IP` | `127.0.0.1` | Pour la borne sur le réseau local, mets l’adresse IP interne du serveur. |
| `CDI_ORIGIN` | Vide | Derrière un reverse proxy, indique l’origine externe exacte, sans chemin ni barre oblique finale. |
| `CDI_IMAGE_TAG` | `latest` | Indique `v1.1.0` si tu veux épingler cette version. |

5. Clique sur **Deploy the stack**. Dans **Containers**, vérifie que l’état du conteneur est sain, puis ouvre ses journaux pour lire la clé de première configuration.
6. Depuis un poste autorisé, ouvre `http://IP_DU_SERVEUR:8080/gestion` avec le port choisi et crée le compte administrateur. La borne est à `/borne` et l’écran de planning à `/planning-ecran`.

Garde la borne sur le réseau de l’établissement. Pour un reverse proxy en conteneur, configure un réseau Docker partagé et fais pointer le proxy vers le service CDI sur le port **8080**. Définis `CDI_ORIGIN` sur l’URL HTTPS utilisée par le navigateur.

## Charger l’image depuis un fichier

Cette option utilise le fichier de la release GitHub, par exemple lorsque l’hôte Docker ne peut pas joindre le registre.

1. Télécharge [Gestion-CDI-Docker-amd64.tar.gz](https://github.com/Xeros59/Gestion-CDI/releases/latest/download/Gestion-CDI-Docker-amd64.tar.gz) sur l’hôte Docker de Portainer.
2. Sur cet hôte, charge le fichier.

   ```bash
   docker load -i Gestion-CDI-Docker-amd64.tar.gz
   docker image ls ghcr.io/xeros59/gestion-cdi
   ```

3. Utilise la même stack avec le tag chargé. Laisse désactivé le repull forcé pour utiliser l’image locale. En cas d’indisponibilité temporaire du registre, tu peux aussi reprendre le tag exact affiché par `docker load`.

## Mettre à jour ou reprendre un CDI existant

1. Télécharge une sauvegarde du CDI et conserve le volume d’origine.
2. Pour passer de l’ancien `build: .` à l’image publiée, modifie **la même stack** en gardant le montage `cdi_data:/data`. Si tu changes de nom de stack, Docker utilise par défaut un autre volume.
3. Pour mettre à jour, change le tag ou demande à Portainer de retélécharger l’image du registre lors de la mise à jour de la stack.
4. Ouvre `/healthz` et vérifie la connexion administrateur, les élèves et le planning.

Pour vérifier le fichier téléchargé sous Linux, télécharge `SHA256SUMS.txt` depuis la même release, puis utilise `sha256sum -c SHA256SUMS.txt --ignore-missing` dans le dossier du téléchargement.
