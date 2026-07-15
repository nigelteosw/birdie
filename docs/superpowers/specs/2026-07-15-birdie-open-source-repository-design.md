# Birdie Open Source Repository Design

**Date:** 2026-07-15

## Goal

Make Birdie straightforward for outside users and contributors to understand, run, deploy, and improve without introducing a large monorepo migration or platform-specific deployment configuration.

## Principles

- Keep the existing `backend/`, `web/`, `skills/`, and static `docs/` boundaries.
- Prefer familiar root-level open source files over custom process documentation.
- Keep contributor automation small and transparent.
- Keep the container compatible with ordinary OCI/Docker hosts.
- Do not add release automation, package publication, or hosting-vendor configuration yet.
- Keep verification lean: existing tests, production builds, and a Docker image build.

## Repository Layout

The application directories remain unchanged:

```text
birdie/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   ├── workflows/ci.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── backend/
├── docs/
├── skills/
├── web/
├── .editorconfig
├── .env.example
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── Dockerfile
├── LICENSE
├── README.md
├── SECURITY.md
├── docker-compose.yml
└── package.json
```

No source code moves into `apps/` or `packages/`. Birdie has only two application workspaces and no shared package boundary that would justify that churn.

Generated output remains untracked. Existing ignored build directories such as `backend/dist`, `web/dist`, dependency directories, worktrees, local environment files, and local data remain outside version control.

## Open Source Project Files

### License

Add the standard MIT license as `Copyright (c) 2026 Birdie contributors`. Add `license`, `description`, `repository`, `bugs`, and `homepage` metadata to the root package manifest. Keep all workspace manifests private so the repository cannot be published to npm accidentally.

### Contributor guidance

`CONTRIBUTING.md` will document:

- prerequisites: Git and Bun 1.3.11;
- local installation and required environment setup;
- backend and web development commands;
- test and production-build commands;
- focused expectations for pull requests;
- the authenticated hosted architecture and persistent SQLite requirement.

`CODE_OF_CONDUCT.md` will use Contributor Covenant 2.1 and direct private enforcement reports to the repository maintainers through GitHub's private vulnerability-reporting channel. `SECURITY.md` will use the same private channel for vulnerabilities and define the supported version as the current `main` branch until Birdie begins issuing releases.

`.editorconfig` will encode UTF-8, LF, final newlines, two-space indentation for the repository's JSON, YAML, Markdown, CSS, and TypeScript conventions, with tabs reserved only where a file format requires them.

### GitHub contribution surfaces

Add two issue forms:

- bug report: environment, reproduction, expected behavior, logs, and deployment context;
- feature request: problem, proposed outcome, and alternatives.

Add a concise pull request template covering scope, verification, screenshots where relevant, and deployment/schema impact. Add a single CI workflow for pushes to `main` and pull requests. It will install the pinned Bun version, run `bun install --frozen-lockfile`, `bun test`, `bun run build`, and `git diff --check`.

Dependabot, automated releases, container publishing, CODEOWNERS, funding metadata, and hosting-vendor workflows are out of scope.

## Environment Example

Keep a single root `.env.example` as the canonical environment template. It will:

- group required authentication values, network settings, and storage paths;
- explain that production `BIRDIE_BASE_URL` must be HTTPS;
- tell operators to generate a unique secret of at least 32 characters;
- identify bootstrap credentials as first-start inputs that do not overwrite an existing admin;
- retain `/data` storage paths so `cp .env.example .env && docker compose up` works;
- note local non-container alternatives as comments rather than changing the defaults.

The obsolete `backend/.env.example` will be removed if it duplicates or contradicts the root template.

## Platform-Neutral Docker Image

The Dockerfile remains at the repository root because that is the conventional build entry point and gives the build access to both workspaces.

### Builder stage

- Pin the image to `oven/bun:1.3.11` rather than a floating major tag.
- Copy workspace manifests and the lockfile first for dependency-layer caching.
- Run `bun install --frozen-lockfile`.
- Copy backend and web sources.
- Run both backend and web production builds.

### Runtime stage

- Use the matching slim Bun 1.3.11 image.
- Set `NODE_ENV=production`, `PORT=6677`, `DB_PATH=/data/birdie.db`, and `DOMAIN_PROFILE_PATH=/data/domain.md` as non-secret defaults.
- Install production dependencies only from the frozen lockfile.
- Copy compiled `backend/dist` and `web/dist`, not TypeScript source or tests.
- Create `/data` for SQLite and the domain profile.
- Expose only port 6677. The internal FastMCP port remains loopback-only inside the container.
- Start `backend/dist/cli.js serve`.
- Retain the public `/__birdie` health check.

The image will not include Railway, Fly.io, Render, Kubernetes, or reverse-proxy configuration. Hosts provide `BIRDIE_BASE_URL`, secrets, public-port mapping, TLS termination, and a persistent volume mounted at `/data`.

`docker-compose.yml` remains a local production-like example. It reads secrets from `.env`, publishes only port 6677, and mounts the named `/data` volume.

## Documentation

Reshape the README into a conventional open source entry point:

1. short project description and capabilities;
2. architecture summary;
3. quick start with Docker;
4. local development;
5. MCP connection instructions;
6. configuration reference;
7. deployment guidance;
8. contributing, security, and license links.

Keep detailed user-facing material in the existing static `docs/` directory. Do not replace it with a documentation framework. Ensure deployment text stays platform-neutral and does not imply that local Birdie storage or stdio MCP still exists.

## Error Handling and Operational Expectations

- Missing or invalid required environment variables continue to stop startup before public listeners bind.
- The Docker health check tests only public process health, not credentials or private data.
- Persistent storage is an operator responsibility and is stated in both README and container documentation.
- TLS is expected at the deployment edge; Birdie accepts HTTP only for loopback development origins.
- Secrets are never committed and example values are visibly placeholders.

## Verification

After reorganization:

1. Run `bun install --frozen-lockfile`.
2. Run `bun test`.
3. Run `bun run build`.
4. Run `docker build -t birdie:local .`.
5. Validate `.github` YAML and JSON/package manifests through their consuming tools where available.
6. Run stale-reference scans for removed local storage/stdio behavior and duplicate environment templates.
7. Run `git diff --check` and inspect `git status --short`.

No new application tests are required because this change affects repository packaging, contributor documentation, CI, and the container build rather than Birdie's runtime behavior.
