ARG NODE_IMAGE=node:24-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24
FROM ${NODE_IMAGE} AS node-source

FROM ${ALPINE_IMAGE} AS base
ARG APP_VERSION=dev
WORKDIR /app
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++ \
    && addgroup -S -g 1000 node \
    && adduser -S -D -H -u 1000 -G node node \
    && mkdir -p /app/data \
    && chown node:node /app/data
# This application uses only Node built-ins; npm and Yarn are not runtime dependencies.
COPY --from=node-source /usr/local/bin/node /usr/local/bin/node
COPY package.json package-lock.json ./
# Fail the build if dependencies are added without updating the image design.
RUN node -e "const p = require('./package.json'); for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) { if (Object.keys(p[key] || {}).length) throw new Error('Container dependency installation must be configured for ' + key); }"
COPY src ./src
COPY public ./public
COPY scripts/healthcheck.js ./scripts/healthcheck.js
LABEL org.opencontainers.image.title="SIT223 HD Task Manager"
LABEL org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/tasks.db \
    APP_ENV=development \
    APP_VERSION=${APP_VERSION}

FROM base AS test
RUN mkdir -p /app/reports && chown node:node /app/reports
COPY test ./test
COPY scripts/ci-report.js ./scripts/ci-report.js
USER node
CMD ["node", "scripts/ci-report.js"]

FROM base AS runtime
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "src/server.js"]
