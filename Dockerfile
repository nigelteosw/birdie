# syntax=docker/dockerfile:1
#
# Builds the Birdie REST API + web UI as a single container, for running the
# "shared team server" mode (`birdie web`) somewhere hostable like Railway,
# Fly.io, or Render. This does NOT run the MCP stdio server — that stays
# local per Claude Code client, per the plugin's design.
#
# Not suited for Vercel: Vercel's serverless functions have an ephemeral
# filesystem, and this server persists state to a SQLite file on disk.

FROM oven/bun:1 AS web-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY patches patches
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
COPY patches patches
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile --production

COPY backend/src backend/src
COPY --from=web-builder /app/web/dist web/dist

EXPOSE 6677

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||6677)+'/__birdie').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "backend/src/cli.ts", "web"]
