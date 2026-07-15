# Birdie shared authentication and remote MCP design

## Problem

Birdie's hosted Express API and React review UI currently have no authentication. Anyone who can reach a deployed server can read, capture, edit, promote, or delete lessons. The current MCP distribution does not solve this: it launches a local stdio server, stores personal data under `~/.birdie`, and optionally proxies tool calls to the same unauthenticated REST API.

That local storage mode also duplicates personal-memory systems already available through `MEMORY.md`, Claude memory, and similar tools. Birdie's distinct value is the shared, human-reviewed team lesson pool, so maintaining a second private memory store adds setup, code, and product ambiguity without strengthening the shared workflow.

## Goal

- Make the hosted Birdie service the only Birdie data store.
- Expose Birdie as a remote Streamable HTTP MCP server at `/mcp`.
- Let MCP clients authenticate through the standard OAuth 2.1 browser flow as soon as they connect.
- Give the React web UI email/password authentication backed by the same users and sessions.
- Bootstrap the first administrator from deployment environment variables.
- Let that administrator create, disable, and reset passwords for other users in the web UI.
- Attribute shared web and MCP activity to authenticated accounts instead of caller-supplied names.
- Remove the local SQLite mode, stdio MCP bridge, bundled MCP binary, and their setup/configuration branches.
- Keep the Birdie plugin's proactive mentorship skill, updated to assume an authenticated remote MCP connection.

## Non-goals

- Public account registration, email verification, password-reset email, magic links, social login, SAML, or SCIM.
- Per-user or per-team content isolation inside one Birdie deployment. Every authenticated user sees the same team lesson pool.
- Content permission tiers. Ordinary users and administrators can perform the same lesson operations; the admin role only controls user management.
- Retaining a personal/local Birdie database or a local stdio-to-REST compatibility bridge.
- Migrating local `~/.birdie/birdie.db` data into the hosted service automatically.
- Replacing SQLite or the current single-container deployment model.

## Product behavior

### Shared MCP onboarding

The primary MCP connection is the hosted URL:

```text
https://birdie.example.com/mcp
```

On first connection, the MCP client receives an OAuth challenge, discovers Birdie's authorization server, and opens the Birdie sign-in page in a browser. The user signs in with the email and password provisioned by an administrator, approves a small Birdie consent screen, and returns to the MCP client authenticated. Authorization Code with PKCE is required. Refresh tokens allow later sessions to reconnect without asking for credentials again.

There is no Birdie-specific token to copy into a config file and no `setup local`/`setup remote` conversation. The MCP client's standard OAuth storage owns its tokens.

### Web onboarding

Unauthenticated visitors see the Birdie sign-in page. There is no sign-up link. After login, every user can capture, review, promote, edit, delete, browse, and search lessons. The UI shows account identity in the header and offers sign out and change password.

Administrators also see a Users screen where they can:

- list users;
- create a user with name, email, and temporary password;
- set a new temporary password;
- disable or re-enable access.

Setting a temporary password revokes that user's existing browser sessions and OAuth refresh tokens. Disabling a user also revokes sessions and causes both web and MCP requests to fail immediately. The UI and server must prevent disabling the final enabled administrator.

### Plugin behavior

The `birdie-mentor` skill remains the proactive behavior layer: it captures mentorship-worthy before/after edits and searches the reviewed lesson pool when a named person's prior approach is relevant. It assumes the `birdie` remote MCP server is already connected. Its first-use, local setup, remembered `user_name`, local review-queue URL, and mode-switching instructions are removed.

## Architecture

Birdie remains one deployable container with one public origin:

```text
https://birdie.example.com
├── /api/auth/*       Better Auth email/password, sessions, and OAuth 2.1
├── /.well-known/*    OAuth authorization and protected-resource metadata
├── /mcp              Express proxy to loopback FastMCP Streamable HTTP
├── /traces            Authenticated Express REST API
├── /lessons           Authenticated Express REST API
├── /domain            Authenticated Express REST API
├── /__birdie          Public health/identity response
└── /*                  React application and public static assets
```

### Public Express server

Express remains the only public listener on `PORT`. It mounts the Better Auth handler before `express.json()`, serves the required well-known discovery documents, authenticates the REST API, proxies `/mcp` without buffering streaming responses, and serves the built React application.

The sign-in page, consent page, Better Auth endpoints, discovery documents, static assets, and `GET /__birdie` are public. Birdie data routes and the main application workspace require authentication.

### Internal FastMCP server

FastMCP runs Streamable HTTP in stateless mode on `127.0.0.1:MCP_INTERNAL_PORT`; the internal port is not exposed by Docker. Express proxies `/mcp` to it so clients use the same public origin as the web app and OAuth issuer.

FastMCP advertises the Better Auth OAuth 2.1 authorization server. Its `authenticate` callback verifies the resource-bound Bearer token, checks issuer, audience, expiry, and scopes, then reloads the user from SQLite to reject disabled accounts immediately. The returned session principal contains the Birdie user ID, name, email, role, and scopes. Tool handlers derive attribution from that principal.

The target FastMCP release must support Streamable HTTP, OAuth discovery, custom authentication, stateless sessions, and the current MCP authorization specification. The implementation plan must pin and verify the chosen release rather than retaining the patched `1.27.7` dependency by default.

### Better Auth authorization server

Better Auth owns email/password hashing, browser sessions, admin roles, OAuth clients, authorization codes, access tokens, refresh tokens, consent, revocation, and signing keys. It uses the existing SQLite database file through a supported SQLite adapter.

The OAuth provider enables dynamic client registration for public MCP clients and requires PKCE S256. Supported scopes are:

- `openid`
- `profile`
- `email`
- `offline_access`
- `birdie:read`
- `birdie:write`

The MCP resource/audience is the canonical public `/mcp` URL. The consent screen lists the requested Birdie scopes and needs one explicit approval on first connection. Existing consent and refresh tokens avoid repeat prompts.

### Shared application services

Express routes and FastMCP tools call the same `AppContext`, repositories, and services directly. FastMCP does not call back through Birdie's REST API. This removes the remote service proxy classes and keeps one validation and persistence path.

## Authentication boundary

Create one internal `AuthenticatedUser`/`RequestPrincipal` contract with:

```ts
interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  scopes: ReadonlySet<'birdie:read' | 'birdie:write'>;
}
```

Browser REST requests resolve a Better Auth session cookie into this contract. FastMCP Bearer requests resolve verified OAuth claims into the same contract and then confirm the user is enabled. Domain services receive the principal explicitly for operations that need attribution; they do not read global request state.

Read endpoints require `birdie:read`; mutation endpoints and tools require `birdie:write`. All provisioned users receive both scopes in v1. Keeping the checks at the boundary preserves room for narrower clients later without adding content roles now.

Cookie-authenticated mutations require same-origin requests and JSON content types. CORS is not enabled broadly. Better Auth continues to own CSRF protection for its own endpoints.

## Bootstrap and configuration

Hosted startup requires:

- `BETTER_AUTH_SECRET`: at least 32 bytes of high-entropy secret material;
- `BIRDIE_BASE_URL`: the canonical HTTPS public origin;
- `BIRDIE_ADMIN_EMAIL`;
- `BIRDIE_ADMIN_PASSWORD`;
- optional `BIRDIE_ADMIN_NAME`, defaulting to the email local part;
- `PORT`, defaulting to `6677`;
- `MCP_INTERNAL_PORT`, using a non-public loopback port;
- `DB_PATH`, defaulting to `/data/birdie.db` in the container;
- `DOMAIN_PROFILE_PATH`, defaulting to `/data/domain.md`.

Startup validates the configuration before opening public listeners. The admin bootstrap is idempotent:

1. Normalize and find `BIRDIE_ADMIN_EMAIL`.
2. If absent, create the credential account with the configured password and `admin` role.
3. If present, ensure it has the `admin` role.
4. Never replace an existing password from the environment on restart.

The configured admin is a normal Birdie user and may capture and review lessons. The environment password is an initial bootstrap credential, not an ongoing source of truth.

## Data model

Better Auth migrations add its standard user, credential account, session, admin-role, OAuth client, consent, authorization-code/token, and signing-key data to the existing SQLite database.

Birdie attribution gains stable account references while preserving readable historical snapshots:

- `traces.submitted_by_user_id TEXT NULL` references the authenticated user.
- `traces.submitted_by TEXT NOT NULL` remains the submitter-name snapshot.
- `lessons.reviewer_user_id TEXT NULL` references the authenticated reviewer.
- `lessons.reviewer TEXT NULL` remains the reviewer-name snapshot.

New hosted requests always set both ID and snapshot name from the principal. Request bodies no longer accept `submitted_by` for capture or `reviewer` for promotion. Existing records keep null IDs and their stored names; they remain visible and searchable but are not guessed onto an account.

"My lessons" filters by `submitted_by_user_id = currentUser.id`. This avoids collisions when two people share a name and removes the current browser-local name preference.

## MCP and REST surfaces

### Remote MCP

The hosted FastMCP server exposes Birdie's content and domain tools and prompts. Local machine configuration tools are removed:

- remove `complete_setup`;
- remove `get_birdie_settings`;
- remove `update_birdie_settings`;
- remove local-mode diagnostics and mode switching;
- keep capture, extraction, review, promotion, retrieval, domain-profile, and review-queue capabilities;
- make `open_review_queue` return `BIRDIE_BASE_URL`.

Remote tool schemas omit identity fields that the authenticated session supplies. The server rejects missing scopes before entering tool logic.

### Express REST API

The existing content routes remain, but every route except `GET /__birdie` requires a browser session or valid Birdie OAuth Bearer token. Capture and promotion derive identity from `req.user`. Admin functions remain under Better Auth's admin API and are surfaced through the React Users screen.

REST authentication failures return `{ "error": "Unauthorized" }` with `401`. Insufficient scope or role returns `403`. MCP authentication failures preserve the OAuth `WWW-Authenticate` challenge required for client discovery.

## Web UI

Add four small authenticated surfaces without introducing a routing library:

1. **Sign in** — email and password only; no sign-up or forgot-password link.
2. **Consent** — identifies the MCP client and requested scopes, with approve/cancel actions.
3. **Account menu** — current name/email, change password, sign out.
4. **Users** — admin-only list, create-user dialog, temporary-password reset, disable/re-enable.

The existing Review queue, My lessons, and Knowledge base tabs remain. Capture no longer asks who submitted the example. Promotion no longer asks for a reviewer name. My lessons uses the authenticated user automatically.

If the session expires, data calls return `401`; the UI clears cached workspace data and returns to sign-in. A `403` renders a permission message without signing the user out. OAuth login and consent preserve the signed continuation query so the MCP client receives its authorization response after authentication.

## Removal and cleanup

Remove code and artifacts that exist only for personal/local storage or the stdio bridge:

- `bin/birdie.mjs` and `scripts/build-plugin-bundle.sh`;
- the root `build:plugin-bundle` script;
- local/remote `BirdieConfig`, `~/.birdie` path handling, setup/status/doctor/mode-switching CLI behavior;
- `backend/src/mcpContext.ts` and its local review-server lifecycle;
- `RemoteTraceService`, `RemoteLessonService`, `RemoteDomainService`, and shared HTTP proxy helper;
- stdio MCP launch configuration from `.claude-plugin/plugin.json`;
- the patched FastMCP dependency if the selected current release no longer needs it;
- obsolete tests for config modes, remote service proxying, and local setup;
- README and skill language for local databases, copied server URLs, remembered names, and unauthenticated shared servers.

Retain the plugin manifest and `skills/birdie-mentor/SKILL.md` so installing the plugin still provides proactive capture/retrieval behavior. Connection documentation must make the remote MCP URL and browser OAuth flow the primary setup.

## Error handling and security

- Refuse hosted startup before binding ports if auth secrets, base URL, admin email, or admin password are invalid.
- Do not log passwords, session cookies, authorization codes, access tokens, or refresh tokens.
- Trust forwarded host/protocol headers only when explicitly configured for the deployment proxy; generate OAuth metadata from `BIRDIE_BASE_URL`, not arbitrary request headers.
- Hash passwords and stored OAuth secrets through Better Auth defaults.
- Validate JWT issuer, resource audience, signature, expiry, and requested scopes on every MCP connection/request.
- Reload user enabled/disabled state for each authenticated REST or MCP request so access removal is immediate even while a short-lived JWT remains cryptographically valid.
- Revoke browser sessions and OAuth refresh tokens after admin password resets or access disablement.
- Keep `/__birdie` free of user, database, or configuration details.
- Rate-limit sign-in, OAuth registration/token, and admin password-reset endpoints using Better Auth's supported controls or a narrow Express limiter where Better Auth does not cover the endpoint.
- Keep FastMCP bound to loopback and expose only the Express public port from Docker.

## Verification

Use a small, risk-focused verification set rather than broad new coverage:

- Auth/bootstrap integration: first startup creates the admin; restart does not reset its password; missing production auth configuration refuses startup.
- REST boundary: anonymous content access returns `401`; a valid session succeeds; capture and promotion use the authenticated user's ID/name rather than request identity fields.
- Admin boundary: ordinary users cannot manage accounts; admin can create and reset a user; disabling a user blocks both session and OAuth access; the final enabled admin cannot be disabled.
- OAuth/FastMCP boundary: unauthenticated `/mcp` returns a discoverable challenge; discovery points to the canonical issuer; a valid resource token reaches one read and one write tool; invalid audience, missing scope, expired token, and disabled user are rejected.
- Migration: existing Birdie rows remain readable with null user IDs; new rows persist stable user IDs.
- Web build plus manual smoke: sign in, admin-create a user, user changes password, MCP Inspector completes PKCE login/consent, capture through MCP, and review the same record in the web UI.
- Run the existing focused backend tests, backend TypeScript build, web build, and `git diff --check`.

## Documentation and deployment

Update README and static docs to show:

1. deploy the single Birdie container with a persistent `/data` volume;
2. configure the auth/base/admin environment variables;
3. visit the web URL and sign in as the bootstrapped admin;
4. create team users;
5. add `https://birdie.example.com/mcp` to a compatible MCP client;
6. complete the browser login and consent flow.

Docker exposes only `PORT`. The health check remains `GET /__birdie`. The attached `/data` volume continues to persist the shared SQLite database and domain profile.

## References

- Better Auth Express integration: <https://better-auth.com/docs/integrations/express>
- Better Auth admin plugin: <https://better-auth.com/docs/plugins/admin>
- Better Auth OAuth 2.1 provider: <https://better-auth.com/docs/plugins/oauth-provider>
- FastMCP authentication and Streamable HTTP: <https://github.com/punkpeye/fastmcp>
- MCP authorization specification: <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
