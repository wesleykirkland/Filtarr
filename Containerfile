# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/

RUN npm run build:all

# Stage 2: Production
FROM node:24-alpine AS runtime

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
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

RUN mkdir -p /config /downloads && \
    chown -R filtarr:filtarr /app /config /downloads

USER filtarr

ENV NODE_ENV=production
ENV FILTARR_VERSION=${OCI_VERSION}
ENV FILTARR_PORT=9898
ENV FILTARR_DATA_DIR=/config

EXPOSE 9898

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9898/api/v1/health || exit 1

CMD ["node", "dist/server/index.js"]
