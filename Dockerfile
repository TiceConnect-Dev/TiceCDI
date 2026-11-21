FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 CDI_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node cdi ./cdi
COPY --chown=node:node standalone ./standalone
COPY --chown=node:node drizzle/*.sql ./drizzle/
COPY --chown=node:node public/cdi ./public/cdi
USER node
EXPOSE 8080
CMD ["node", "standalone/server.mjs"]
