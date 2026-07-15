# syntax=docker/dockerfile:1
FROM oven/bun:1.3.11 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile

COPY backend backend
COPY web web
RUN bun run build

FROM oven/bun:1.3.11-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=6677 \
    DB_PATH=/data/birdie.db \
    DOMAIN_PROFILE_PATH=/data/domain.md

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile --production --filter @birdie/backend && mkdir -p /data

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/web/dist web/dist

EXPOSE 6677

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||6677)+'/__birdie').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "backend/dist/cli.js", "serve"]
