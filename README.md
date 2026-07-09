# Birdie

Birdie captures before/after edits as mentorship examples, lets an MCP-connected assistant extract a candidate lesson, gates promotion on human review, and answers two questions from reviewed lessons: how a senior handled something, and what a junior is struggling with.

Birdie makes no LLM calls. The connected MCP host does the reasoning; Birdie stores, validates, and retrieves the data.

## Run Locally

```bash
bun install
bun run build
bun run test
```

## Local Plugin Setup

Use this path when you want Claude Code to run Birdie locally through the plugin, with data stored on this machine.

1. Install dependencies from this checkout:

   ```bash
   bun install
   ```

2. In Claude Code, install the plugin from this local repo:

   ```text
   /plugin install /Users/nigel/Projects/Birdie/birdie
   ```

3. Start a new Claude Code conversation, then ask Birdie to set itself up. When it asks whether you have a team server URL, choose local mode.

   The setup writes:

   - `~/.birdie/config.json`
   - `~/.birdie/birdie.db`
   - `~/.birdie/domain.md` if you customize the domain profile

4. Use Birdie from chat:

   - Ask it to capture a before/after edit as a mentorship example.
   - Ask it to extract a lesson from the captured example.
   - Ask it to review or promote pending lessons.
   - Birdie will offer the review queue link on its own whenever lessons are pending — it starts the local server on demand and drops a `127.0.0.1` URL into the reply, no need to ask for it.

No shared server URL is needed for this setup. The plugin runs the MCP server locally with Bun and stores everything under `~/.birdie/`.

The first MCP use should run the `setup-birdie` prompt, then `complete_setup` with either local mode or a shared server URL.

## Development Notes

- Local config: `~/.birdie/config.json`
- Local database: `~/.birdie/birdie.db`
- Local domain profile: `~/.birdie/domain.md`, falling back to `domain.md`
- Dev overrides: `BIRDIE_CONFIG_PATH`, `DB_PATH`, `DOMAIN_PROFILE_PATH`, `PORT`

### Running components standalone

The plugin only needs the MCP server; it starts the web UI itself on demand when you ask Birdie to open the review queue. Run these directly only if you're working outside the plugin — e.g. hitting the REST API on its own, or iterating on the web UI with hot reload:

```bash
bun run dev:backend -- web   # REST API + web UI only
bun run dev:backend -- mcp   # MCP server only
```

## REST API

- `POST /traces`
- `GET /traces`
- `GET /traces/:id`
- `POST /traces/:id/skip`
- `POST /traces/:id/extract`
- `GET /lessons`
- `GET /lessons/:id`
- `PATCH /lessons/:id`
- `POST /lessons/:id/promote`
- `GET /lessons/ask/senior-approach`
- `GET /lessons/ask/junior-struggles`
- `GET /domain`
