<img src="docs/assets/birdie-mascot.png" alt="Birdie" width="96" />

# Birdie

Birdie turns real before/after edits into reviewed team lessons. It exposes one hosted web UI, authenticated REST API, and OAuth 2.1 remote MCP endpoint. The connected MCP host does the reasoning; Birdie stores, validates, reviews, and retrieves the shared data.

## Run locally

Birdie requires Bun and a persistent SQLite path.

```bash
bun install
BETTER_AUTH_SECRET=replace-with-at-least-32-characters \
BIRDIE_BASE_URL=http://localhost:6677 \
BIRDIE_ADMIN_EMAIL=admin@example.com \
BIRDIE_ADMIN_PASSWORD=replace-with-12-plus-characters \
DB_PATH=./data/birdie.db \
DOMAIN_PROFILE_PATH=./data/domain.md \
bun run dev:backend
```

Open `http://localhost:6677` and sign in with the bootstrap admin credentials. On first start Birdie creates that admin; later starts never overwrite an existing account's password. The admin can create users, set temporary passwords, revoke sessions, and disable accounts in the Users tab.

## Connect an MCP client

Add this remote MCP URL to Claude Code, Codex, ChatGPT, or any client supporting Streamable HTTP and OAuth:

```text
https://birdie.example.com/mcp
```

The client discovers Birdie's OAuth metadata, opens the web sign-in and consent flow, and returns with a resource-bound token. Captures and promotions are attributed to that account. There is no local Birdie database or stdio bridge.

The Claude plugin in this repository is skill-only: it adds proactive capture and retrieval behavior. Configure the hosted `/mcp` connection separately using your MCP client's normal remote-server setup.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes | — | At least 32 characters; signs auth state and tokens. |
| `BIRDIE_BASE_URL` | yes | — | Public origin, HTTPS except on loopback. |
| `BIRDIE_ADMIN_EMAIL` | yes | — | Bootstrap admin email. |
| `BIRDIE_ADMIN_PASSWORD` | yes | — | Bootstrap password, at least 12 characters. |
| `BIRDIE_ADMIN_NAME` | no | email prefix | Admin display name. |
| `PORT` | no | `6677` | Public web, REST, OAuth, and `/mcp` listener. |
| `MCP_INTERNAL_PORT` | no | `6678` | Loopback-only FastMCP listener. |
| `DB_PATH` | no | `/data/birdie.db` | Shared SQLite database. |
| `DOMAIN_PROFILE_PATH` | no | `/data/domain.md` | Shared domain guidance. |

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Mount `/data` on persistent storage. Only the public `PORT` should be exposed; FastMCP stays on loopback and Express proxies streaming requests to it. Use a container host with a persistent disk (Railway, Fly.io, Render, or a VPS), not an ephemeral serverless filesystem.

## Development

```bash
bun run build
bun test
```

The authenticated application routes are `/traces`, `/lessons`, `/domain`, and `/api/admin/*`. Better Auth owns `/api/auth/*`; OAuth discovery is published under `/.well-known/*`; remote MCP is `/mcp`; `GET /__birdie` is the public health check.

The `docs/` directory is a static GitHub Pages site and needs no build step.
