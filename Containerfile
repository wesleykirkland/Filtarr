# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production
FROM node:24-alpine AS runtime

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
ENV FILTARR_PORT=9898
ENV FILTARR_DATA_DIR=/config

EXPOSE 9898

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:9898/api/v1/health || exit 1

CMD ["node", "dist/server/index.js"]
