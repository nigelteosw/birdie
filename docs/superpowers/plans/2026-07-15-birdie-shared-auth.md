# Birdie Shared Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Birdie's unauthenticated local/remote split with one hosted Express + FastMCP service where web users sign in with email/password and remote MCP clients authenticate through OAuth 2.1.

**Architecture:** Express remains the public listener and hosts Better Auth, authenticated REST routes, static React assets, OAuth discovery, and a streaming proxy to a loopback FastMCP server. Better Auth owns users, cookies, and OAuth 2.1; FastMCP validates resource tokens and passes the same authenticated principal into Birdie's services.

**Tech Stack:** Bun 1.3.11, TypeScript, Express 4, React 18, SQLite, Better Auth 1.6.23, `@better-auth/oauth-provider` 1.6.23, FastMCP 4.4.0, `http-proxy-middleware` 4.2.0, Zod, Bun test, Vitest.

## Global Constraints

- Hosted Birdie is the only Birdie data store; remove local SQLite and stdio MCP modes.
- Public signup, password-reset email, social login, SSO, and content permission tiers are out of scope.
- Admin status controls accounts only; every enabled user can read/write the shared lesson pool.
- Browser requests use Better Auth cookies; MCP requests use OAuth Authorization Code + PKCE.
- Hosted clients cannot supply `submitted_by` or `reviewer`; identity comes from authentication.
- Existing rows keep display-name snapshots and receive nullable user IDs.
- Preserve the proactive plugin skill but remove its local MCP launch/setup behavior.
- Keep tests focused on auth/bootstrap, attribution, admin access, MCP OAuth, migration, and builds.
- Raise the Node engine floor to `>=22.15.0` for `http-proxy-middleware@4.2.0`.

---

### Task 1: Auth dependencies, configuration, and bootstrap

**Files:**
- Modify: `package.json`, `backend/package.json`, `web/package.json`, `bun.lock`
- Create: `backend/src/runtimeConfig.ts`, `backend/src/auth.ts`, `backend/src/authBootstrap.ts`
- Test: `backend/test/runtimeConfig.test.ts`, `backend/test/authBootstrap.test.ts`

**Interfaces:**
- Produces: `HostedConfig`, `readHostedConfig()`, `createBirdieAuth()`, `initializeAuth()`.

- [ ] Add exact dependencies: `better-auth@1.6.23`, `@better-auth/oauth-provider@1.6.23`, `fastmcp@4.4.0`, `http-proxy-middleware@4.2.0`; add Vitest browser test dependencies; run `bun install`.
- [ ] Write `runtimeConfig.test.ts` first. Assert normalization of `BIRDIE_BASE_URL`/admin email, defaults `PORT=6677` and `MCP_INTERNAL_PORT=6678`, secret length >=32, password length >=12, and HTTPS outside localhost.
- [ ] Run `bun test backend/test/runtimeConfig.test.ts`; expect module-not-found RED.
- [ ] Implement `readHostedConfig(env)` with a Zod schema and this public contract:

```ts
export interface HostedConfig {
  secret: string;
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  port: number;
  mcpInternalPort: number;
  dbPath: string;
  domainPath: string;
}
```

- [ ] Re-run the config test; expect GREEN.
- [ ] Write `authBootstrap.test.ts` first against a temporary SQLite file. Assert first startup creates an admin, a second startup does not reset a changed password, and a pre-existing ordinary account is promoted to admin.
- [ ] Run the bootstrap test; expect missing auth factory/bootstrap RED.
- [ ] Implement Better Auth with Bun SQLite, `emailAndPassword({ disableSignUp: true })`, `admin()`, `jwt()`, and `oauthProvider()` configured for `/sign-in`, `/consent`, dynamic public registration, audience `${baseUrl}/mcp`, and scopes `openid profile email offline_access birdie:read birdie:write`.
- [ ] Implement programmatic `getMigrations(auth.options).runMigrations()` and idempotent `auth.api.listUsers`/`createUser`/`setRole` bootstrap. Never set an existing password from the environment.
- [ ] Run `bun test backend/test/runtimeConfig.test.ts backend/test/authBootstrap.test.ts` and `bun run --cwd backend build`; expect exit 0.
- [ ] Commit: `git commit -am "feat: add hosted Birdie auth foundation"` after staging new files.

---

### Task 2: Stable authenticated attribution

**Files:**
- Modify: `backend/src/db.ts`, `backend/src/types.ts`, repositories, services, `backend/src/context.ts`
- Test: `backend/test/db.test.ts`, `backend/test/services.test.ts`, `backend/test/lessonRepository.test.ts`

**Interfaces:**
- Produces: `Trace.submitted_by_user_id`, `Lesson.reviewer_user_id`, `LessonFilters.submitted_by_user_id`.

- [ ] Add failing tests for fresh/legacy nullable ID columns, capture ID/name persistence, promotion ID/name persistence, and ID-based My Lessons filtering.
- [ ] Run focused tests; expect missing-column/type RED.
- [ ] Add nullable `submitted_by_user_id TEXT REFERENCES user(id)` and `reviewer_user_id TEXT REFERENCES user(id)` with idempotent `ALTER TABLE` migration helpers.
- [ ] Extend public types exactly:

```ts
export interface NewTrace {
  submitted_by_user_id?: string | null;
  submitted_by: string;
  before_text: string;
  after_text: string;
  context_note?: string | null;
}
export interface PromotePayload {
  reviewer_user_id?: string | null;
  reviewer: string;
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
}
```

- [ ] Update repository SQL, row mapping, services, and `submitted_by_user_id` filtering.
- [ ] Re-run focused tests; expect GREEN.
- [ ] Commit: `git commit -m "feat: attribute Birdie records to users"`.

---

### Task 3: Shared principal and protected Express API

**Files:**
- Create: `backend/src/authPrincipal.ts`, `backend/src/express.d.ts`
- Modify: `backend/src/server.ts`, `backend/src/routes/traces.ts`, `backend/src/routes/lessons.ts`
- Test: `backend/test/authBoundary.test.ts`, `backend/test/routes.test.ts`

**Interfaces:**
- Produces: `AuthenticatedUser`, `PrincipalResolver`, `requirePrincipal()`, `requireScope()` and `req.user`.

- [ ] Write failing tests: anonymous `/lessons` returns 401; spoofed submitter/reviewer fields are ignored; valid principals persist their IDs/names; ordinary users cannot call admin helpers.
- [ ] Run the boundary tests; expect RED.
- [ ] Implement:

```ts
export type BirdieScope = 'birdie:read' | 'birdie:write';
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  scopes: ReadonlySet<BirdieScope>;
  disabled: boolean;
}
```

- [ ] Mount Better Auth at `/api/auth/*` before `express.json()`. Keep sign-in, consent, well-known endpoints, static assets, and `/__birdie` public. Protect `/traces`, `/lessons`, and `/domain`.
- [ ] Remove `submitted_by` from capture Zod bodies and `reviewer` from promotion bodies. Populate both snapshot and user ID from `req.user`.
- [ ] Replace arbitrary My Lessons name filtering with `mine=true`, translated server-side to `submitted_by_user_id=req.user.id`.
- [ ] Run boundary/routes tests; expect GREEN.
- [ ] Commit: `git commit -m "feat: protect Birdie REST API"`.

---

### Task 4: OAuth-authenticated remote FastMCP

**Files:**
- Modify: `backend/src/mcp/server.ts`, `backend/src/mcp/tools.ts`, `backend/src/mcp/prompts.ts`
- Create: `backend/src/mcp/httpServer.ts`, `backend/src/mcp/principal.ts`
- Test: `backend/test/mcpAuth.test.ts`, `backend/test/tools.test.ts`

**Interfaces:**
- Produces: `createRemoteMcpServer()` and `startRemoteMcpServer()` with authenticated session `{ user: AuthenticatedUser }`.

- [ ] Write failing tests proving local setup/config tools are absent, capture/promotion use the authenticated session, read/write scopes are enforced, and `open_review_queue` returns `BIRDIE_BASE_URL`.
- [ ] Run MCP/tool tests; expect RED against the old `McpContext` design.
- [ ] Refactor tools to accept `AppContext` and the FastMCP session principal directly. Keep capture, extraction, review, promotion, retrieval, domain profile, and review-queue tools/prompts only.
- [ ] Implement Bearer verification using Better Auth OAuth resource verification: validate signature, issuer, `${baseUrl}/mcp` audience, expiry, and scopes; reload the user and reject disabled/banned accounts.
- [ ] Configure FastMCP 4.4.0 Streamable HTTP with endpoint `/mcp`, `stateless: true`, and loopback host/port.
- [ ] Run MCP/tool tests and backend build; expect GREEN/exit 0.
- [ ] Commit: `git commit -m "feat: expose OAuth authenticated remote MCP"`.

---

### Task 5: One hosted lifecycle and public streaming proxy

**Files:**
- Modify: `backend/src/cli.ts`, `backend/src/server.ts`, `backend/src/context.ts`
- Test: `backend/test/serverLifecycle.test.ts`, `backend/test/routes.test.ts`

**Interfaces:**
- Produces: `serveBirdie()` startup order: config -> context/auth -> migrations/admin -> internal MCP -> public Express.

- [ ] Write failing lifecycle tests with injected factories. Assert no listener starts before auth initialization and proxy failures return 503 without exposing the internal URL.
- [ ] Run lifecycle tests; expect RED.
- [ ] Replace CLI local/remote/stdin modes with `serve` (default). Start FastMCP on loopback, then Express on `0.0.0.0:${PORT}`.
- [ ] Mount `createProxyMiddleware` at `/mcp` before JSON parsing; preserve streaming, `WWW-Authenticate`, MCP session headers, and status codes.
- [ ] Run lifecycle/routes tests; expect GREEN.
- [ ] Commit: `git commit -m "feat: run web and remote MCP as one service"`.

---

### Task 6: Authenticated React UI and user administration

**Files:**
- Create: `web/src/auth-client.ts`, `AuthGate.tsx`, `SignIn.tsx`, `Consent.tsx`, `AccountMenu.tsx`, `UserManagement.tsx`
- Create: `web/src/auth-ui.test.tsx`, `web/vitest.config.ts`, `web/test/setup.ts`
- Modify: `web/src/main.tsx`, `App.tsx`, `api.ts`, `CaptureForm.tsx`, `MyLessons.tsx`, `ReviewList.tsx`, `styles.css`, `vite.config.ts`

**Interfaces:**
- Produces: browser sign-in/consent/account/admin screens and identity-free Birdie request payloads.

- [ ] Write failing Vitest/Testing Library tests: email/password sign-in without sign-up; consent calls `oauth2.consent`; Users appears only for admin; CaptureForm has no Submitted by field.
- [ ] Run `bun run --cwd web test`; expect RED.
- [ ] Create the Better Auth React client with `adminClient()` and `oauthProviderClient()`.
- [ ] Implement `AuthGate` using `useSession`, `SignIn` using `signIn.email`, `Consent` using `publicClient`/`consent`, `AccountMenu` using `changePassword`/`signOut`, and `UserManagement` using list/create/set-password/ban/unban/revoke-session methods.
- [ ] Add a server-side and UI guard against disabling the final enabled admin.
- [ ] Remove manual identity fields: CaptureForm sends before/after/context; ReviewList omits reviewer; MyLessons requests `mine=true`; API fetches use `credentials: 'same-origin'` and broadcast auth expiry on 401.
- [ ] Run web tests and `bun run --cwd web build`; expect GREEN/exit 0.
- [ ] Commit: `git commit -m "feat: add authenticated Birdie web UI"`.

---

### Task 7: Remove local mode and update distribution/deployment

**Files:**
- Delete: `backend/src/config.ts`, `backend/src/mcpContext.ts`, `backend/src/services/http.ts`, `backend/src/services/remote*Service.ts`
- Delete: obsolete config/MCP-context/remote-service tests
- Delete: `bin/birdie.mjs`, `scripts/build-plugin-bundle.sh`, `patches/fastmcp@1.27.7.patch`
- Modify: `.claude-plugin/plugin.json`, `skills/birdie-mentor/SKILL.md`, `README.md`, `docs/index.html`, `Dockerfile`, `docker-compose.yml`, manifests

**Interfaces:**
- Produces: one hosted onboarding path and a skill-only plugin.

- [ ] Run a stale-surface RED scan for `setup local`, `setup remote`, `~/.birdie`, `BIRDIE_CONFIG_PATH`, `build:plugin-bundle`, `bin/birdie.mjs`, stdio transport, and remote service classes; confirm matches.
- [ ] Delete obsolete code/tests/artifacts and remove the old FastMCP patch mapping/build script.
- [ ] Remove `mcpServers` from the plugin manifest but retain metadata and the proactive skill.
- [ ] Rewrite the skill first-use instructions: connect the team's `https://<host>/mcp`; OAuth opens automatically; never offer local storage or remembered names.
- [ ] Rewrite README/static docs: deploy persistent `/data`, set auth/admin env, sign in, create users, connect `/mcp`, complete OAuth.
- [ ] Update Docker/Compose to expose only public `PORT`; keep FastMCP internal and health check public.
- [ ] Re-run the stale-surface scan; expect no current-code/docs matches.
- [ ] Run `bun test`, backend build, web tests, web build, and `git diff --check`; expect exit 0.
- [ ] Commit: `git commit -m "refactor: remove local Birdie storage mode"`.

---

### Task 8: Live OAuth/discovery smoke and final verification

**Files:**
- Modify only if smoke checks reveal a defect: current auth/MCP/docs files.

**Interfaces:**
- Produces: fresh evidence for public health, REST auth, OAuth metadata, MCP challenge, login/consent, and cross-surface data.

- [ ] Start Birdie with a temporary SQLite DB, localhost base URL, 32-byte secret, and bootstrap admin credentials.
- [ ] Verify `GET /__birdie` is 200, anonymous `GET /lessons` is 401, protected-resource metadata is 200 and points to the Better Auth issuer, and anonymous MCP initialize is 401 with `WWW-Authenticate`.
- [ ] Use MCP Inspector if available to complete PKCE login/consent, call one read and one write tool, and confirm the record in the signed-in web UI. If browser tooling is unavailable, report this separately from source/build verification.
- [ ] Fix any smoke defect with a failing test first, then re-run its focused verification.
- [ ] Run fresh final verification: `bun test && bun run build && bun run --cwd web test && git diff --check && git status --short`.
- [ ] Commit smoke-driven corrections only if any were required.
