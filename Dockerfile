# syntax=docker/dockerfile:1
#
# Builds Birdie's web UI, authenticated API, OAuth server, and remote MCP
# endpoint as one container. Mount /data on persistent storage.

FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile
COPY web web
RUN bun run --cwd web build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/birdie.db \
    DOMAIN_PROFILE_PATH=/data/domain.md

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile --production

COPY backend/src backend/src
COPY --from=web-builder /app/web/dist web/dist

EXPOSE 6677

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||6677)+'/__birdie').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "backend/src/cli.ts", "serve"]
