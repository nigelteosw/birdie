<img src="docs/assets/birdie-mascot.png" alt="Birdie" width="96" />

# Birdie

Birdie captures before/after edits as mentorship examples, lets an MCP-connected assistant extract a candidate lesson, and gates promotion on human review. Reviewed lessons become a searchable library of mentorship examples.

Birdie makes no LLM calls. The connected MCP host does the reasoning; Birdie stores, validates, and retrieves the data.

## Run Locally

```bash
bun install
bun run build
bun run test
```

## Plugin Setup

Install Birdie from GitHub — no `bun install`, no cloning, nothing to run in a terminal. The plugin ships as a precompiled, self-contained MCP server binary for macOS, Linux, and Windows; Node is only used to pick and launch the right one.

1. In Claude Code:

   ```text
   /plugin marketplace add nigelteosw/birdie
   /plugin install birdie
   ```

2. Start a new Claude Code conversation, then ask Birdie to set itself up. When it asks whether you have a team server URL, choose local mode.

   The setup writes:

   - `~/.birdie/config.json`
   - `~/.birdie/birdie.db`
   - `~/.birdie/domain.md` if you customize the domain profile

3. Use Birdie from chat:

   - Ask it to capture a before/after edit as a mentorship example.
   - Ask it to extract a lesson from the captured example.
   - Ask it to review or promote pending lessons.
   - Birdie will offer the review queue link on its own whenever lessons are pending — it starts the local server on demand and drops a `127.0.0.1` URL into the reply, no need to ask for it.

No shared server URL is needed for this setup. The plugin runs the MCP server locally and stores everything under `~/.birdie/`.

The first MCP use should run the `setup-birdie` prompt, then `complete_setup` with either local mode or a shared server URL.

### Starting and stopping the local server

There's nothing to start or stop by hand. The REST+web server that backs the review queue starts itself, lazily, the first time it's needed in a session (whether you ask for it or Birdie offers it) — it binds to `127.0.0.1` and stays up for the rest of that session so repeat requests reuse the same URL instead of spawning a new server each time. It has no separate stop command: it goes away on its own when the MCP connection ends (closing the conversation, reloading the plugin, or quitting Claude Code). It is not a background daemon that persists across restarts.

By default it binds to a fixed port, `http://127.0.0.1:6677`, so you always know where to find it without asking Birdie. Override it with the `PORT` env var (e.g. set `env: { "PORT": "..." }` on the `birdie` entry in `.claude-plugin/plugin.json`'s `mcpServers`, or export it before running standalone). If two Claude Code windows both start Birdie locally, the second one detects the first is already serving on port 6677 and reuses that URL instead of erroring. If port 6677 is already taken by something unrelated to Birdie, it falls back to a random free port rather than handing back the wrong server's URL.

### Switching between local and a shared team server

Ask Birdie to switch at any point — e.g. "switch me to the team server at https://birdie.example.com" or "go back to local mode." That re-runs `complete_setup` with the new mode, which overwrites `~/.birdie/config.json`; since every tool call re-reads that config, the switch takes effect immediately on the next request, no restart needed. Switching doesn't migrate data: your local `~/.birdie/birdie.db` is left untouched (nothing is pushed to the shared server, nothing is deleted), so switching back to local later picks up right where that local db left off, and switching to remote just points new activity at the shared server instead.

You can also use the `configure-birdie` MCP prompt, or ask Birdie to show settings, run diagnostics, switch mode, or update categories. The plugin exposes `get_birdie_settings`, `update_birdie_settings`, `get_domain_profile`, `save_domain_profile`, and `birdie_doctor` for assistants that prefer direct tool calls.

### Sharing one local backend across assistants

Claude, ChatGPT, Codex, and other MCP clients cannot share a single stdio MCP process. They can share one Birdie backend if each client points its own Birdie MCP process at the same server URL.

Start the backend:

```bash
bun run dev:backend -- web
```

Then configure each client with remote/shared-server mode:

```text
http://127.0.0.1:6677
```

Use a LAN or tunnel URL instead of `127.0.0.1` if the client runs on a different machine.

## Development Notes

- Local config: `~/.birdie/config.json`
- Local database: `~/.birdie/birdie.db`
- Local domain profile: `~/.birdie/domain.md`, falling back to `domain.md`
- Dev overrides: `BIRDIE_CONFIG_PATH`, `DB_PATH`, `DOMAIN_PROFILE_PATH`, `PORT`

### CLI settings

```bash
birdie status
birdie doctor
birdie setup local
birdie setup remote http://127.0.0.1:6677
birdie config show
birdie config path
birdie domain show
birdie domain set ./my-domain-profile.md
```

## Docker / Hosting a Shared Server

The `Dockerfile` at the repo root builds the REST API + web UI (`birdie web` — not the MCP stdio server, which always stays local to each Claude Code client) into a single container, for teams who want a real shared backend instead of a laptop running `bun run dev:backend -- web`.

```bash
docker compose up --build
# → http://localhost:6677
```

Data lives at `/data/birdie.db` inside the container; `docker-compose.yml` mounts a named volume there so it survives restarts and rebuilds. Point remote clients at the container's URL the same way as any shared server (see "Sharing one local backend across assistants" above).

The image is plain Docker with no platform-specific config, so any host that builds a Dockerfile and can attach a persistent volume works — Railway, Fly.io, Render, a bare VPS, etc. Two things every host needs to be told:

- Mount a persistent volume at `/data` — without it, the SQLite file resets on every redeploy.
- The server reads `PORT` from the environment (default `6677`) and exposes `GET /__birdie` as a health check, so wire those into whatever health-check/port config the host expects.

**Vercel is not a fit for this image.** Vercel functions run on an ephemeral filesystem with no persistent disk, so a file-backed SQLite database won't survive between invocations or deploys. Use a host that runs a persistent container with an attached volume instead.

**Before exposing this publicly:** the REST API has no authentication — anyone who can reach the URL can read, create, and promote lessons. That's fine for `127.0.0.1`/LAN/tunnel use, but a public Railway URL should sit behind a proxy auth layer (e.g. Railway's built-in access control, or a reverse proxy adding a shared secret) until the API itself gains an auth mechanism.

## GitHub Pages Docs

This repo includes a static documentation site in `docs/`. To publish it with GitHub Pages:

1. Push the repo to GitHub.
2. Open the repo's **Settings** > **Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Choose your default branch and the `/docs` folder.
5. Save the setting. No build step is required.

### Running components standalone

The plugin only needs the MCP server; it starts the web UI itself on demand when you ask Birdie to open the review queue. Run these directly only if you're working outside the plugin — e.g. hitting the REST API on its own, or iterating on the web UI with hot reload:

```bash
bun run dev:backend -- web   # REST API + web UI only
bun run dev:backend -- mcp   # MCP server only
```

### Releasing the plugin bundle

The plugin (`.claude-plugin/plugin.json`) launches a bundled MCP server via `bin/birdie.mjs`, not `backend/src/cli.ts` directly. After a backend change that should ship to plugin users, rebuild and commit the bundle:

```bash
bun run build:plugin-bundle
git add bin/birdie.mjs
```

## REST API

- `POST /traces`
- `GET /traces`
- `GET /traces/:id`
- `POST /traces/:id/skip`
- `POST /traces/:id/extract`
- `GET /lessons` — accepts `status`, `typology`, `playbook_ref`, `submitted_by`, and `q` (keyword search across quote/what_changed/why_it_matters) query params
- `GET /lessons/:id`
- `PATCH /lessons/:id`
- `POST /lessons/:id/promote`
- `GET /domain`
- `GET /__birdie` — identity marker used to detect an existing Birdie instance before reusing its port
