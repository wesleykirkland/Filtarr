# Base images are pinned to the multi-arch index digest of node:24-alpine; Renovate
# keeps the digest current. Resolve manually with:
#   docker buildx imagetools inspect node:24-alpine --format '{{json .Manifest.Digest}}'

# Stage 1: Build
# node:24-alpine, pinned by digest only (tag kept here for humans; renovate updates the digest)
FROM node@sha256:6d2c7d5d074bf72f81ddc252b4fbb5d625bc028eeda49cb4b8c2ff8eda1ee617 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps g++ make python3 && \
    npm ci --ignore-scripts && \
    npm rebuild bcrypt better-sqlite3 && \
    apk del .build-deps

COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/

RUN npm run build:all

# Stage 2: Production
# node:24-alpine, same digest as the builder stage
FROM node@sha256:6d2c7d5d074bf72f81ddc252b4fbb5d625bc028eeda49cb4b8c2ff8eda1ee617 AS runtime

ARG OCI_VERSION=0.1.0
ARG OCI_REVISION=unknown
ARG OCI_CREATED=unknown
ARG OCI_SOURCE=https://github.com/wesleykirkland/Filtarr
ARG OCI_REF_NAME=dev

LABEL org.opencontainers.image.title="Filtarr" \
      org.opencontainers.image.description="Arr stack companion — file monitoring, blocklist management, and automation" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.url="${OCI_SOURCE}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.created="${OCI_CREATED}" \
      org.opencontainers.image.ref.name="${OCI_REF_NAME}"

RUN addgroup -g 1001 -S filtarr && \
    adduser -u 1001 -S filtarr -G filtarr

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache bash && \
    apk add --no-cache --virtual .build-deps g++ make python3 && \
    npm ci --omit=dev --ignore-scripts && \
    npm rebuild bcrypt better-sqlite3 && \
    apk del .build-deps && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

# /app (code and node_modules) stays root-owned and read-only for the app user;
# only the data dir (/config) and /downloads are writable.
RUN mkdir -p /config /downloads && \
    chown filtarr:filtarr /config /downloads

USER filtarr

ENV NODE_ENV=production
ENV FILTARR_VERSION=${OCI_VERSION}
ENV FILTARR_PORT=9898
ENV FILTARR_DATA_DIR=/config

EXPOSE 9898

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9898/api/v1/health || exit 1

CMD ["node", "dist/server/index.js"]
