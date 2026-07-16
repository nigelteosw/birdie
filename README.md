<img src="docs/assets/birdie-mascot.png" alt="Birdie" width="96" />

# Birdie

Birdie helps teams stop giving the same correction twice. It turns real before/after feedback into a simple, reviewed lesson:

1. **What was initially wrong.**
2. **What to do instead.**
3. **Why it matters.**

The connected work tool detects and drafts useful lessons. People review what becomes shared guidance, and Birdie brings approved lessons back when similar work appears. Everyone can contribute and everyone can learn; Birdie has no mentor/learner hierarchy.

Birdie provides one hosted web UI, authenticated REST API, and OAuth 2.1 remote MCP endpoint. The connected client supplies the language-model judgment; Birdie preserves source evidence, verifies quotes, enforces review state, detects repeated guidance, and retrieves candidates for current work. MCP is one supported capture and delivery adapter, not the product's defining value.

The same account works in the browser and through MCP. On first start, Birdie creates the configured admin user. That admin can create other users, issue temporary passwords, revoke sessions, and disable accounts from the web UI.

## Architecture

- Express exposes the web UI, REST API, Better Auth routes, OAuth metadata, and `/mcp` through one public port.
- Better Auth provides email/password sessions for the web UI and OAuth 2.1 authorization for MCP clients.
- FastMCP listens on a loopback-only internal port and is proxied by Express.
- A database adapter stores users, sessions, captures, and reviewed lessons. SQLite is the default; PostgreSQL with pgvector is optional.
- The React/Vite application is compiled into the production image and served by Express.

Birdie does not run a local memory database or stdio bridge. Local MCP use is a personal connection to the same hosted endpoint; repository files such as `MEMORY.md` remain a separate concern.

## Quick start with Docker

Install Docker with Compose support, then:

```bash
cp .env.example .env
docker compose up --build
```

Replace the example secret, email, and password in `.env` before starting. Open [http://localhost:6677](http://localhost:6677) and sign in with the bootstrap admin credentials. Restarts never overwrite an existing account's password.

## Connect an MCP client

Add Birdie's Streamable HTTP endpoint using your MCP client's normal remote-server setup:

```text
http://localhost:6677/mcp
```

For a deployed instance, use its public HTTPS origin, for example `https://birdie.example.com/mcp`. The client discovers Birdie's OAuth metadata, opens the same web sign-in and consent flow, and returns with a resource-bound token. Captures and promotions are attributed to that signed-in account.

The Claude plugin in this repository is skill-only: it adds proactive correction capture and contextual guidance checks. Configure the `/mcp` connection separately in your client.

## Local development

Birdie uses [Bun](https://bun.sh/) 1.3.11 workspaces.

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Start the backend on the port expected by Vite's development proxy:

```bash
PORT=4000 \
BIRDIE_BASE_URL=http://localhost:4000 \
DB_PATH=./data/birdie.db \
DOMAIN_PROFILE_PATH=./data/domain.md \
bun run dev:backend
```

In a second terminal, run `bun run dev:web`, then open [http://localhost:5173](http://localhost:5173). The credentials still come from `.env`.

The main project checks are:

```bash
bun test
bun run build
```

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes | — | At least 32 characters; signs auth state and tokens. |
| `BIRDIE_BASE_URL` | yes | — | Public origin, using HTTPS except on loopback. |
| `BIRDIE_ADMIN_EMAIL` | yes | — | Email for the bootstrapped admin user. |
| `BIRDIE_ADMIN_PASSWORD` | yes | — | Initial admin password, at least 12 characters. |
| `BIRDIE_ADMIN_NAME` | no | email prefix | Admin display name. |
| `PORT` | no | `6677` | Public web, REST, OAuth, and MCP listener. |
| `MCP_INTERNAL_PORT` | no | `6678` | Loopback-only FastMCP listener; do not publish it. |
| `BIRDIE_DB_ADAPTER` | no | `sqlite` | Database adapter: `sqlite` or `postgres`. |
| `DB_PATH` | no | `/data/birdie.db` | Shared SQLite database. |
| `DATABASE_URL` | with PostgreSQL | — | PostgreSQL connection URL; the database must permit the `vector` extension. |
| `DOMAIN_PROFILE_PATH` | no | `/data/domain.md` | Shared domain guidance. |

See [.env.example](.env.example) for a copy-ready container configuration.

### PostgreSQL and pgvector

To run Birdie on PostgreSQL, configure:

```env
BIRDIE_DB_ADAPTER=postgres
DATABASE_URL=postgresql://birdie:password@database-host:5432/birdie
```

On startup, Birdie runs the Better Auth schema migrations, creates its trace and lesson tables, enables pgvector with `CREATE EXTENSION IF NOT EXISTS vector`, and creates an HNSW cosine index for promoted-lesson retrieval.

Birdie generates its default vectors locally by hashing overlapping character trigrams into 512 dimensions. This provides fast fuzzy lexical matching without a model, API key, or inference service; it should not be described as model-based semantic understanding.

Custom builds can implement the [`DBAdapter`](backend/src/adapters/types.ts) contract, export it through the adapter entrypoint, and pass it as the second argument to `serveBirdie(config, adapter)`. Adapter operations are asynchronous so remote databases do not require changes to the service, REST, or MCP layers.

## Deploying Birdie

The included Dockerfile builds a standard OCI image and does not depend on a specific hosting platform. For production:

1. Terminate TLS in front of Birdie and set `BIRDIE_BASE_URL` to the exact public HTTPS origin.
2. For SQLite, mount persistent storage at `/data` and run one writable application replica. PostgreSQL deployments can scale application replicas against the shared database.
3. Publish only `PORT`; keep `MCP_INTERNAL_PORT` private inside the container.
4. Configure the platform's HTTP health check to request `GET /__birdie`.
5. Store `BETTER_AUTH_SECRET` and the bootstrap credentials in the platform's secret manager.

The authenticated application routes are `/traces`, `/lessons`, `/domain`, and `/api/admin/*`. Better Auth owns `/api/auth/*`; OAuth discovery is under `/.well-known/*`; remote MCP is `/mcp`.

## Documentation

The [`docs/`](docs/) directory is a static GitHub Pages site and needs no build step. MCP behavior for supported coding agents lives in [`skills/birdie-mentor/`](skills/birdie-mentor/).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Community participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Birdie is available under the [MIT License](LICENSE).
