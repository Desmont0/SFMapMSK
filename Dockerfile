FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts
COPY tests ./tests
COPY public ./public
RUN npm run build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data SECRETS_DIR=/app/secrets
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node public/geo ./public/geo
COPY --chown=node:node scripts/setup-admin.ts ./scripts/setup-admin.ts
COPY --chown=node:node scripts/migrate.ts ./scripts/migrate.ts
COPY --chown=node:node scripts/export.ts scripts/cache-map.ts ./scripts/
RUN mkdir -p /app/data /app/secrets && chown node:node /app/data /app/secrets
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:'+(process.env.SHARE_PORT||3001)+'/api/health');if(!r.ok)process.exit(1)"]
CMD ["node", "--import", "tsx", "server/index.ts"]
