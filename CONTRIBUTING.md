# Contributing to Birdie

Thanks for helping make Birdie better. Keep pull requests focused, explain the problem being solved, and include verification appropriate to the change.

## Development setup

Birdie uses Bun 1.3.11 workspaces.

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run dev:backend
bun run dev:web
```

The example environment uses container paths. For bare local development, set `DB_PATH=./data/birdie.db` and `DOMAIN_PROFILE_PATH=./data/domain.md`. Deployed containers should persist `/data`.

Run the existing checks before submitting a pull request:

```bash
bun test
bun run build
```

## Pull requests

- Keep changes scoped and avoid unrelated cleanup.
- Do not commit secrets, local databases, dependency directories, or generated `dist/` output.
- Add or update tests when application behavior changes.
- Call out changes to the SQLite schema, environment variables, OAuth or MCP behavior, and deployment requirements.
- Update public documentation when setup or user-facing behavior changes.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
