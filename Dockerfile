# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Toolchain only needed if a native module has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY web ./web
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PUBLIC_PORT=3000 \
    ADMIN_PORT=3001 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIR=/app/dist/web
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PUBLIC_PORT||3000)+'/bistro/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/server/index.js"]
