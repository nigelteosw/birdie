# Birdie Open Source Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Birdie contributor-friendly and deployment-ready with conventional open source project files, lightweight GitHub automation, one canonical environment template, and a platform-neutral production container.

**Architecture:** Preserve the existing `backend/`, `web/`, `skills/`, and static `docs/` boundaries. Add only root-level community metadata and `.github` contribution surfaces, then convert the container from runtime TypeScript execution to a pinned multi-stage build that runs compiled backend JavaScript and bundled web assets.

**Tech Stack:** Bun 1.3.11 workspaces, TypeScript, React/Vite, Express, FastMCP, Better Auth, SQLite, Docker/OCI, GitHub Actions.

## Global Constraints

- Keep `backend/`, `web/`, `skills/`, and static `docs/` in their current locations.
- Use the MIT license with `Copyright (c) 2026 Birdie contributors`.
- Keep all npm workspace packages private.
- Do not add Dependabot, release automation, container publishing, CODEOWNERS, funding metadata, or hosting-vendor configuration.
- Keep `.env.example` as the only canonical environment template.
- Pin container build and runtime images to Bun 1.3.11.
- Copy compiled `backend/dist` and `web/dist` into the runtime image; do not run TypeScript source in production.
- Expose only public port 6677; keep FastMCP's internal port loopback-only.
- Preserve `/data` as the persistent storage mount and `/__birdie` as the public health check.
- Keep verification lean: existing tests, production builds, structural scans, and one Docker image build.

---

### Task 1: Add conventional project metadata and contributor guidance

**Files:**
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.editorconfig`
- Modify: `package.json`

**Interfaces:**
- Consumes: Bun commands and environment requirements documented in `README.md` and `backend/src/runtimeConfig.ts`.
- Produces: stable contributor, security, license, and package metadata linked from the README in Task 3.

- [ ] **Step 1: Confirm the conventional root files are missing**

Run:

```bash
for file in LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .editorconfig; do test -f "$file" || echo "missing: $file"; done
```

Expected: one `missing:` line for each new file.

- [ ] **Step 2: Add the MIT license**

Create `LICENSE` using the standard MIT text beginning with:

```text
MIT License

Copyright (c) 2026 Birdie contributors
```

and retaining the complete permission and warranty clauses from the standard OSI MIT license.

- [ ] **Step 3: Add contributor and security documentation**

Create `CONTRIBUTING.md` with these exact operational commands:

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run dev:backend
bun run dev:web
bun test
bun run build
```

Explain that development may use `DB_PATH=./data/birdie.db` and `DOMAIN_PROFILE_PATH=./data/domain.md`, while deployed containers persist `/data`. Require focused pull requests, no committed secrets or generated `dist/` output, and explicit notes for schema/environment/deployment changes.

Create `SECURITY.md` with:

```markdown
## Supported versions

Until Birdie publishes versioned releases, only the current `main` branch receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting flow for this repository and include impact, reproduction steps, and any suggested mitigation.
```

Create Contributor Covenant 2.1 as `CODE_OF_CONDUCT.md`. Set enforcement contact to the repository maintainers through GitHub private vulnerability reporting and link the official Contributor Covenant FAQ and translations.

- [ ] **Step 4: Add editor and package metadata**

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

Add these fields to the root `package.json`, keeping `private: true`:

```json
{
  "description": "Authenticated shared mentorship capture for web and MCP clients.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nigelteosw/birdie.git"
  },
  "bugs": {
    "url": "https://github.com/nigelteosw/birdie/issues"
  },
  "homepage": "https://github.com/nigelteosw/birdie#readme"
}
```

- [ ] **Step 5: Validate and commit project metadata**

Run:

```bash
bun -e "JSON.parse(await Bun.file('package.json').text()); console.log('package metadata valid')"
git diff --check
```

Expected: `package metadata valid`, followed by exit 0.

Commit:

```bash
git add LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .editorconfig package.json
git commit -m "docs: add open source project conventions"
```

---

### Task 2: Add lightweight GitHub contribution surfaces and CI

**Files:**
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `bun test` and `bun run build` scripts.
- Produces: structured GitHub reports, consistent pull requests, and a single required CI workflow.

- [ ] **Step 1: Confirm GitHub contribution files are absent**

Run:

```bash
for file in .github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/feature_request.yml .github/PULL_REQUEST_TEMPLATE.md .github/workflows/ci.yml; do test -f "$file" || echo "missing: $file"; done
```

Expected: four `missing:` lines.

- [ ] **Step 2: Add issue forms and pull request template**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/nigelteosw/birdie/security/advisories/new
    about: Report security issues privately.
```

The bug form must require description, reproduction steps, expected behavior, Birdie commit/version, operating system, Bun version, and deployment type. The feature form must require the underlying problem, desired outcome, and alternatives considered. Both forms must include a checkbox confirming that the reporter searched existing issues.

Create `.github/PULL_REQUEST_TEMPLATE.md` with these headings:

```markdown
## Summary

## Verification

## Screenshots

## Deployment and data impact
```

Under deployment impact, prompt authors to identify environment-variable, SQLite-schema, OAuth/MCP, and container changes.

- [ ] **Step 3: Add the Bun CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: bun run build
      - run: git diff --check
```

- [ ] **Step 4: Validate and commit GitHub files**

Run:

```bash
bun -e "for (const path of ['.github/ISSUE_TEMPLATE/config.yml','.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/workflows/ci.yml']) { const text = await Bun.file(path).text(); if (!text.trim()) throw new Error(path + ' is empty'); } console.log('github files present')"
git diff --check
```

Expected: `github files present`, followed by exit 0.

Commit:

```bash
git add .github
git commit -m "ci: add contributor templates and verification"
```

---

### Task 3: Consolidate environment and public documentation

**Files:**
- Modify: `.env.example`
- Delete: `backend/.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: environment contract from `backend/src/runtimeConfig.ts`; community files from Task 1.
- Produces: one copy-ready Docker environment file and a conventional project landing page.

- [ ] **Step 1: Confirm the duplicate environment template and current README structure**

Run:

```bash
test -f backend/.env.example && echo "duplicate backend environment template exists"
rg -n "^## " README.md
```

Expected: the duplicate-template line and the current README headings.

- [ ] **Step 2: Rewrite the canonical environment template**

Replace `.env.example` with grouped comments and every key accepted by `readHostedConfig()`:

```dotenv
# Required authentication settings
# Generate a unique value, for example: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-with-a-unique-secret-of-at-least-32-characters

# Public HTTPS origin in production. Loopback HTTP is allowed for local use.
BIRDIE_BASE_URL=http://localhost:6677

# Bootstrapped only when this email does not exist; restarts do not reset it.
BIRDIE_ADMIN_EMAIL=admin@example.com
BIRDIE_ADMIN_PASSWORD=replace-with-a-password-of-at-least-12-characters
BIRDIE_ADMIN_NAME=Birdie Admin

# Network
PORT=6677
MCP_INTERNAL_PORT=6678

# Persistent container storage. For bare local development, use ./data paths.
DB_PATH=/data/birdie.db
DOMAIN_PROFILE_PATH=/data/domain.md
```

Delete `backend/.env.example` so contributors cannot choose a stale template accidentally.

- [ ] **Step 3: Reorganize the README**

Keep the existing mascot and concise product explanation. Reorder the README into:

```markdown
## Architecture
## Quick start with Docker
## Connect an MCP client
## Local development
## Configuration
## Deploying Birdie
## Documentation
## Contributing
## Security
## License
```

The Docker quick start must use `cp .env.example .env` and `docker compose up --build`. The deployment section must remain vendor-neutral, require TLS termination and a persistent `/data` mount, expose only `PORT`, and point health checks to `/__birdie`. Link `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, and the static `docs/` directory.

- [ ] **Step 4: Scan documentation and commit**

Run:

```bash
test ! -f backend/.env.example
rg -n "setup local|setup remote|~/.birdie|bin/birdie\.mjs|stdio MCP|Railway|Fly\.io|Render" README.md .env.example || true
git diff --check
```

Expected: no obsolete or vendor-specific matches, followed by exit 0.

Commit:

```bash
git add .env.example README.md backend/.env.example
git commit -m "docs: consolidate setup and deployment guidance"
```

---

### Task 4: Build a pinned platform-neutral production container

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: backend build output `backend/dist/cli.js`; web build output `web/dist`; environment contract from Task 3.
- Produces: an OCI image that runs `bun backend/dist/cli.js serve` and persists state under `/data`.

- [ ] **Step 1: Record the current container build behavior**

Run:

```bash
rg -n "FROM|COPY|RUN|CMD|HEALTHCHECK|EXPOSE" Dockerfile
```

Expected: floating Bun image tags and a runtime command using `backend/src/cli.ts`.

- [ ] **Step 2: Replace the Dockerfile with a compiled multi-stage build**

Use this structure:

```dockerfile
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
RUN bun install --frozen-lockfile --production && mkdir -p /data

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/web/dist web/dist

EXPOSE 6677

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||6677)+'/__birdie').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "backend/dist/cli.js", "serve"]
```

- [ ] **Step 3: Tighten build context and Compose example**

Ensure `.dockerignore` excludes dependency directories, all `dist` directories, local data, `.env`, Git metadata, internal planning documents, tests, and TypeScript build-info files while leaving the workspace manifests and sources available.

Keep `docker-compose.yml` vendor-neutral. It must:

- build from `.`;
- publish `6677:6677` only;
- pass auth/admin values from `.env`;
- set `BIRDIE_BASE_URL=http://localhost:6677` for the local example;
- mount a named volume at `/data`;
- health-check `GET /__birdie`.

- [ ] **Step 4: Build and inspect the image**

Run:

```bash
docker build --progress=plain -t birdie:local .
docker image inspect birdie:local --format '{{json .Config.Cmd}} {{json .Config.ExposedPorts}}'
```

Expected: build exit 0 and output containing `backend/dist/cli.js`, `serve`, and `6677/tcp`.

- [ ] **Step 5: Run final repository verification and commit**

Run:

```bash
bun install --frozen-lockfile
bun test
bun run build
git diff --check
git status --short
```

Expected: the existing test suite passes, backend/web builds exit 0, no whitespace errors, and only the intended Docker-related files remain uncommitted.

Commit:

```bash
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "build: add platform neutral production image"
```

---

### Task 5: Final cross-file audit

**Files:**
- Modify only if audit reveals inconsistency: `README.md`, `.env.example`, `CONTRIBUTING.md`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all outputs from Tasks 1-4.
- Produces: a clean repository whose documented commands match local and container behavior.

- [ ] **Step 1: Audit commands, versions, routes, and paths**

Run:

```bash
rg -n "1\.3\.11|/data|/__birdie|6677|bun test|bun run build" README.md CONTRIBUTING.md .env.example Dockerfile docker-compose.yml .github/workflows/ci.yml package.json
rg -n "setup local|setup remote|~/.birdie|bin/birdie\.mjs|backend/src/cli\.ts.*serve|oven/bun:1([^.]|$)|Railway|Fly\.io|Render" README.md CONTRIBUTING.md .env.example Dockerfile docker-compose.yml .github || true
```

Expected: the first scan shows consistent current values; the second scan has no matches.

- [ ] **Step 2: Run fresh completion verification**

Run:

```bash
bun test && bun run build && git diff --check && git status --short
```

Expected: tests and builds exit 0, no whitespace errors, and a clean worktree after any audit correction is committed. Task 4's successful image build is the container verification evidence; do not repeat it unless Docker-related files changed during this audit.
