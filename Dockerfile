ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY scripts/healthcheck.js ./scripts/healthcheck.js

FROM base AS test
COPY test ./test
COPY scripts/ci-report.js ./scripts/ci-report.js
CMD ["npm", "run", "test:ci"]

FROM base AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="SIT223 HD Task Manager"
LABEL org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/tasks.db \
    APP_ENV=development \
    APP_VERSION=${APP_VERSION}
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "src/server.js"]
