FROM node:24-alpine
LABEL org.opencontainers.image.title="TiceCDI" org.opencontainers.image.licenses="LicenseRef-TiceCDI-NonCommercial" org.opencontainers.image.source="https://github.com/TiceConnect-Dev/TiceCDI"
WORKDIR /app
ENV NODE_ENV=production PORT=8080 CDI_DATA_DIR=/data
# L'application n'a aucune dépendance npm : npm, npx, yarn et corepack sont retirés de l'image
# pour réduire la surface d'attaque. Les mises à jour de sécurité Alpine sont appliquées au build.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn* \
 && mkdir -p /data && chown node:node /data && chmod 700 /data
COPY --chown=root:root LICENSE ./LICENSE
COPY --chown=root:root cdi ./cdi
COPY --chown=root:root standalone ./standalone
COPY --chown=root:root drizzle/*.sql ./drizzle/
COPY --chown=root:root public/cdi ./public/cdi
# Le code appartient à root et reste en lecture seule pour l'utilisateur « node » qui exécute le service.
USER node
EXPOSE 8080
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "standalone/server.mjs"]
