# Birdie Mentorship Capture Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Birdie — an MCP server (plus a minimal REST API and one-page web UI) distributed as a Claude Code plugin, that captures before/after mentorship examples, lets an MCP-connected AI assistant extract lessons from them, gates promotion on human review, and serves two audiences (junior asking how a senior handled something, senior asking what a junior is struggling with) over the same reviewed pool — with zero-terminal setup and plain-language chat for the non-technical people who actually use it day to day.

**Architecture:** A single TypeScript/Bun backend package with a repository layer over SQLite (`bun:sqlite`), a thin service layer enforcing the business rules (quote verification, domain-profile-validated typology, promotion gating), and two transports sharing that service layer: an MCP server (`fastmcp`, tools + prompts) and a REST API (`express`) backing a one-page React web UI. The REST/web path is always local-SQLite-backed; only the MCP tool layer branches between a local (SQLite, in-process) and remote (HTTP client against someone else's already-running Birdie server) implementation, selected via `~/.birdie/config.json`, written through a guided first-run chat conversation rather than hand-edited. No LLM provider code anywhere — reasoning happens in whichever model is running the connected MCP host. Primary distribution is a Claude Code plugin (`.claude-plugin/plugin.json`) bundling the MCP server and the `birdie-mentor` Skill; manual MCP registration (Claude Desktop, Codex CLI, local dev) remains a secondary/advanced path using the same underlying `birdie` CLI.

**Tech Stack:** TypeScript, Bun workspaces/runtime/test runner, `bun:sqlite`, `express`, `fastmcp`, `zod`, React + Vite for the web UI.

## Global Constraints

- **Local-by-default, opt-in shared server**: a solo user gets a working single SQLite file with zero setup beyond installing the plugin; a team can instead point the plugin at an existing shared Birdie server's URL during first-run setup. No auth, no multi-tenant — a shared server is a trusted-network assumption, not a hosted multi-user service Birdie builds tooling for.
- **Zero-terminal setup**: nothing in the primary (Claude Code plugin) path requires `bun install`, editing a `.env` file, or hand-editing MCP config JSON or `~/.birdie/config.json`. Setup is a guided chat conversation (`setup-birdie` MCP prompt) that calls `complete_setup` / `save_domain_profile` on the user's behalf.
- **Plain language for non-technical users**: every user-visible surface (tool descriptions, the web UI, the Skill's phrasing) uses the vocabulary in `backend/src/copy.ts` / `web/src/copy.ts` (e.g. "example" not "trace", "category" not "typology") — internal type/column/parameter names stay precise and technical, but nothing a user reads should require knowing them.
- Birdie makes **zero LLM API calls** and holds no model credentials — all reasoning (extraction, ask synthesis, setup conversation) happens in the connected MCP host's model via tool calls.
- **Quote verification is done in code**, never delegated to the model — `quote` must be a verbatim substring of `before_text`.
- **Promotion always requires a human reviewer name** and is only possible from `status='pending_review'`.
- `typology` is **free text validated against the loaded domain profile**, not a hardcoded enum — the profile must be swappable per-field (law, audit, tax, software, etc.) without a code change, and is normally produced through the `setup-birdie` chat interview rather than hand-edited markdown.
- All wire-facing data (REST JSON bodies/queries, MCP tool parameters, DB columns) uses **snake_case field names**, exactly matching the design spec's data model and API sections. Internal plumbing identifiers (class names, service/repository method names, local variables) use idiomatic camelCase.
- The web UI is **one page, two parts** (a capture form and a review queue) — no routing, no tabs, no separate library-browsing screen — and is secondary to chat, started on request via `open_review_queue` rather than run as a standing background process.
- Full design reference: `docs/superpowers/specs/2026-07-08-birdie-mentorship-plugin-design.md`.

---

### Task 1: Repo scaffold

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore` (root)
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/src/types.ts`

**Interfaces:**
- Produces: `Trace`, `NewTrace`, `TraceStatus`, `Lesson`, `LessonWithTrace`, `NewExtraction`, `LessonEdit`, `PromotePayload`, `LessonFilters`, `PlaybookAlignment`, `SubmittedByRole`, `TraceServiceLike`, `LessonServiceLike` — the domain types every later task imports from `backend/src/types.ts`.

- [ ] **Step 1: Create the root workspace `package.json`**

```json
{
  "name": "birdie",
  "private": true,
  "workspaces": ["backend", "web"],
  "packageManager": "bun@1.3.11",
  "scripts": {
    "build": "bun run --cwd backend build && bun run --cwd web build",
    "test": "bun run --cwd backend test",
    "dev:backend": "bun run --cwd backend dev",
    "dev:web": "bun run --cwd web dev"
  }
}
```

- [ ] **Step 2: Create the root `.gitignore`**

```
node_modules/
dist/
data/
.env
```

- [ ] **Step 3: Create `backend/package.json`**

```json
{
  "name": "@birdie/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "birdie": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "bun src/cli.ts",
    "test": "bun test"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "fastmcp": "^1.20.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 4: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `backend/.env.example`**

```
DB_PATH=./data/birdie.db
DOMAIN_PROFILE_PATH=./domain.md
PORT=4000
```

- [ ] **Step 6: Create `backend/src/types.ts`**

```typescript
export type TraceStatus = 'captured' | 'extracted' | 'skipped';
export type LessonStatus = 'pending_review' | 'rejected' | 'promoted';
export type PlaybookAlignment = 'aligned' | 'diverges' | 'not_applicable';
export type SubmittedByRole = 'senior' | 'junior';

export interface Trace {
  id: string;
  submitted_by: string;
  submitted_by_role: SubmittedByRole;
  junior_name: string | null;
  senior_name: string | null;
  before_text: string;
  after_text: string;
  playbook_ref: string | null;
  playbook_text: string | null;
  context_note: string | null;
  source: string;
  status: TraceStatus;
  skip_reason: string | null;
  created_at: string;
}

export interface NewTrace {
  submitted_by: string;
  submitted_by_role: SubmittedByRole;
  junior_name?: string | null;
  senior_name?: string | null;
  before_text: string;
  after_text: string;
  playbook_ref?: string | null;
  playbook_text?: string | null;
  context_note?: string | null;
  source?: string;
}

export interface Lesson {
  id: string;
  trace_id: string;
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment: PlaybookAlignment | null;
  playbook_note: string | null;
  status: LessonStatus;
  reviewer: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export interface LessonWithTrace extends Lesson {
  junior_name: string | null;
  senior_name: string | null;
  playbook_ref: string | null;
}

export interface NewExtraction {
  trace_id: string;
  quote: string;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment?: PlaybookAlignment | null;
  playbook_note?: string | null;
}

export interface LessonEdit {
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
  typology?: string;
  status?: 'rejected';
}

export interface PromotePayload {
  reviewer: string;
  quote?: string;
  what_changed?: string;
  why_it_matters?: string;
  typology?: string;
}

export interface LessonFilters {
  status?: LessonStatus;
  typology?: string;
  playbook_ref?: string;
  junior_name?: string;
  senior_name?: string;
}

// Async on purpose, even though the local (SQLite) implementation is synchronous under the
// hood: the MCP tool layer (Task 6) is typed against these interfaces so a local and a remote
// (HTTP, necessarily async) implementation can both satisfy it. See Task 15.
export interface TraceServiceLike {
  capture(input: NewTrace): Promise<Trace>;
  get(id: string): Promise<Trace | undefined>;
  list(status?: TraceStatus): Promise<Trace[]>;
  skip(id: string, reason: string): Promise<Trace>;
  extract(input: NewExtraction): Promise<LessonWithTrace>;
}

export interface LessonServiceLike {
  list(filters: LessonFilters): Promise<LessonWithTrace[]>;
  get(id: string): Promise<LessonWithTrace | undefined>;
  review(id: string, changes: LessonEdit): Promise<LessonWithTrace>;
  promote(id: string, payload: PromotePayload): Promise<LessonWithTrace>;
  askSeniorApproach(question: string, senior_name?: string): Promise<LessonWithTrace[]>;
  askJuniorStruggles(junior_name?: string): Promise<{ lessons: LessonWithTrace[]; typology_counts: Record<string, number> }>;
}
```

- [ ] **Step 7: Install dependencies and verify the build**

Run: `bun install` (from repo root)
Expected: installs succeed for the root and `backend` workspaces (the `web` workspace doesn't exist yet, so Bun will just skip it).

Run: `bun run --cwd backend build`
Expected: `tsc` compiles `backend/src/types.ts` to `backend/dist/types.js` with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore backend/package.json backend/tsconfig.json backend/.env.example backend/src/types.ts bun.lock
git commit -m "Scaffold Bun workspaces and backend domain types"
```

---

### Task 2: SQLite schema and repositories

**Files:**
- Create: `backend/src/db.ts`
- Create: `backend/src/repositories/traceRepository.ts`
- Create: `backend/src/repositories/lessonRepository.ts`
- Test: `backend/test/repositories.test.ts`

**Interfaces:**
- Consumes: `Trace`, `NewTrace`, `TraceStatus`, `Lesson`, `LessonWithTrace`, `NewExtraction`, `LessonEdit`, `LessonFilters`, `PromotePayload` from `backend/src/types.ts` (Task 1).
- Produces: `openDb(dbPath: string): Database`; `class TraceRepository` with `create(input: NewTrace): Trace`, `getById(id: string): Trace | undefined`, `list(status?: TraceStatus): Trace[]`, `markExtracted(id: string): void`, `markSkipped(id: string, reason: string): void`; `class LessonRepository` with `create(input: NewExtraction & { quote_verified: boolean }): LessonWithTrace`, `getById(id: string): LessonWithTrace | undefined`, `getByTraceId(traceId: string): LessonWithTrace | undefined`, `list(filters: LessonFilters): LessonWithTrace[]`, `edit(id: string, changes: LessonEdit): LessonWithTrace`, `promote(id: string, payload: PromotePayload): LessonWithTrace`. Both repositories take a `Database` instance in their constructor.

- [ ] **Step 1: Create `backend/src/db.ts`**

```typescript
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(dbPath: string): Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      submitted_by TEXT NOT NULL,
      submitted_by_role TEXT NOT NULL,
      junior_name TEXT,
      senior_name TEXT,
      before_text TEXT NOT NULL,
      after_text TEXT NOT NULL,
      playbook_ref TEXT,
      playbook_text TEXT,
      context_note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'captured',
      skip_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES traces(id),
      quote TEXT NOT NULL,
      quote_verified INTEGER NOT NULL,
      what_changed TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      typology TEXT NOT NULL,
      playbook_alignment TEXT,
      playbook_note TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      reviewer TEXT,
      reviewed_at TEXT,
      promoted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_trace_id ON lessons(trace_id);
  `);
}
```

- [ ] **Step 2: Write the failing repository tests**

Create `backend/test/repositories.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';

describe('TraceRepository', () => {
  let db: Database;
  let traces: TraceRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    traces = new TraceRepository(db);
  });

  it('creates and retrieves a trace', () => {
    const trace = traces.create({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
      before_text: 'The Indemnifying Party shall indemnify all losses.',
      after_text: 'The Indemnifying Party shall indemnify losses capped at fees paid.',
    });
    expect(trace.status).toBe('captured');
    expect(traces.getById(trace.id)?.before_text).toContain('Indemnifying Party');
  });

  it('lists traces filtered by status', () => {
    const trace = traces.create({ submitted_by: 'Jane', submitted_by_role: 'junior', before_text: 'a', after_text: 'b' });
    traces.markExtracted(trace.id);
    expect(traces.list('extracted')).toHaveLength(1);
    expect(traces.list('captured')).toHaveLength(0);
  });

  it('marks a trace skipped with a reason', () => {
    const trace = traces.create({ submitted_by: 'Jane', submitted_by_role: 'junior', before_text: 'a', after_text: 'b' });
    traces.markSkipped(trace.id, 'Pure typo fix, not a judgment call.');
    const updated = traces.getById(trace.id)!;
    expect(updated.status).toBe('skipped');
    expect(updated.skip_reason).toBe('Pure typo fix, not a judgment call.');
  });
});

describe('LessonRepository', () => {
  let db: Database;
  let traces: TraceRepository;
  let lessons: LessonRepository;
  let traceId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    traces = new TraceRepository(db);
    lessons = new LessonRepository(db);
    traceId = traces.create({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      playbook_ref: 'NDA §4.3',
    }).id;
  });

  it('creates a pending lesson', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'Capped the indemnity at fees paid.',
      why_it_matters: 'Uncapped indemnities expose the client to unlimited liability.',
      typology: 'substantive_risk',
    });
    expect(lesson.status).toBe('pending_review');
  });

  it('filters by junior_name and senior_name via the joined trace', () => {
    lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lessons.list({ junior_name: 'Jane' })).toHaveLength(1);
    expect(lessons.list({ senior_name: 'Sarah' })).toHaveLength(1);
    expect(lessons.list({ junior_name: 'Someone Else' })).toHaveLength(0);
  });

  it('edits fields in place and can reject', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'other',
    });
    const edited = lessons.edit(lesson.id, { typology: 'substantive_risk', status: 'rejected' });
    expect(edited.typology).toBe('substantive_risk');
    expect(edited.status).toBe('rejected');
  });

  it('recomputes quote verification when editing the quote', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'substantive_risk',
    });
    const edited = lessons.edit(lesson.id, { quote: 'not in the original' });
    expect(edited.quote_verified).toBe(false);
  });

  it('promotes a pending lesson and stamps reviewer/timestamps', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'substantive_risk',
    });
    const promoted = lessons.promote(lesson.id, { reviewer: 'Sarah' });
    expect(promoted.status).toBe('promoted');
    expect(promoted.reviewer).toBe('Sarah');
    expect(promoted.promoted_at).not.toBeNull();
  });

  it('recomputes quote verification when promotion includes an edited quote', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'not in the original',
      quote_verified: false,
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'substantive_risk',
    });
    const promoted = lessons.promote(lesson.id, { reviewer: 'Sarah', quote: 'uncapped indemnity' });
    expect(promoted.quote_verified).toBe(true);
  });

  it('refuses to promote a lesson that is not pending_review', () => {
    const lesson = lessons.create({
      trace_id: traceId,
      quote: 'uncapped indemnity',
      quote_verified: true,
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'substantive_risk',
    });
    lessons.promote(lesson.id, { reviewer: 'Sarah' });
    expect(() => lessons.promote(lesson.id, { reviewer: 'Sarah' })).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run --cwd backend test`
Expected: FAIL — `Cannot find module '../src/repositories/traceRepository.js'` (the repository files don't exist yet).

- [ ] **Step 4: Create `backend/src/repositories/traceRepository.ts`**

```typescript
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceRepository {
  constructor(private db: Database) {}

  create(input: NewTrace): Trace {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO traces (id, submitted_by, submitted_by_role, junior_name, senior_name, before_text, after_text, playbook_ref, playbook_text, context_note, source, status)
         VALUES (@id, @submitted_by, @submitted_by_role, @junior_name, @senior_name, @before_text, @after_text, @playbook_ref, @playbook_text, @context_note, @source, 'captured')`
      )
      .run({
        id,
        submitted_by: input.submitted_by,
        submitted_by_role: input.submitted_by_role,
        junior_name: input.junior_name ?? null,
        senior_name: input.senior_name ?? null,
        before_text: input.before_text,
        after_text: input.after_text,
        playbook_ref: input.playbook_ref ?? null,
        playbook_text: input.playbook_text ?? null,
        context_note: input.context_note ?? null,
        source: input.source ?? 'manual',
      });
    return this.getById(id)!;
  }

  getById(id: string): Trace | undefined {
    return this.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as Trace | undefined;
  }

  list(status?: TraceStatus): Trace[] {
    if (status) {
      return this.db.prepare('SELECT * FROM traces WHERE status = ? ORDER BY created_at DESC').all(status) as Trace[];
    }
    return this.db.prepare('SELECT * FROM traces ORDER BY created_at DESC').all() as Trace[];
  }

  markExtracted(id: string): void {
    this.db.prepare("UPDATE traces SET status = 'extracted' WHERE id = ?").run(id);
  }

  markSkipped(id: string, reason: string): void {
    this.db.prepare("UPDATE traces SET status = 'skipped', skip_reason = ? WHERE id = ?").run(reason, id);
  }
}
```

- [ ] **Step 5: Create `backend/src/repositories/lessonRepository.ts`**

```typescript
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { LessonWithTrace, LessonEdit, LessonFilters, NewExtraction, PromotePayload } from '../types.js';

interface LessonRow extends Omit<LessonWithTrace, 'quote_verified'> {
  quote_verified: number;
}

function rowToLesson(row: LessonRow): LessonWithTrace {
  return { ...row, quote_verified: row.quote_verified === 1 };
}

export class LessonRepository {
  constructor(private db: Database) {}

  create(input: NewExtraction & { quote_verified: boolean }): LessonWithTrace {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO lessons (id, trace_id, quote, quote_verified, what_changed, why_it_matters, typology, playbook_alignment, playbook_note, status)
         VALUES (@id, @trace_id, @quote, @quote_verified, @what_changed, @why_it_matters, @typology, @playbook_alignment, @playbook_note, 'pending_review')`
      )
      .run({
        id,
        trace_id: input.trace_id,
        quote: input.quote,
        quote_verified: input.quote_verified ? 1 : 0,
        what_changed: input.what_changed,
        why_it_matters: input.why_it_matters,
        typology: input.typology,
        playbook_alignment: input.playbook_alignment ?? null,
        playbook_note: input.playbook_note ?? null,
      });
    return this.getById(id)!;
  }

  getById(id: string): LessonWithTrace | undefined {
    const row = this.db
      .prepare(
        `SELECT l.*, t.junior_name, t.senior_name, t.playbook_ref
         FROM lessons l JOIN traces t ON t.id = l.trace_id
         WHERE l.id = ?`
      )
      .get(id) as LessonRow | undefined;
    return row ? rowToLesson(row) : undefined;
  }

  getByTraceId(traceId: string): LessonWithTrace | undefined {
    const row = this.db
      .prepare(
        `SELECT l.*, t.junior_name, t.senior_name, t.playbook_ref
         FROM lessons l JOIN traces t ON t.id = l.trace_id
         WHERE l.trace_id = ?`
      )
      .get(traceId) as LessonRow | undefined;
    return row ? rowToLesson(row) : undefined;
  }

  private beforeTextForLesson(id: string): string {
    const row = this.db
      .prepare('SELECT t.before_text FROM lessons l JOIN traces t ON t.id = l.trace_id WHERE l.id = ?')
      .get(id) as { before_text: string } | undefined;
    if (!row) throw new Error(`Lesson not found: ${id}`);
    return row.before_text;
  }

  list(filters: LessonFilters): LessonWithTrace[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filters.status) {
      clauses.push('l.status = @status');
      params.status = filters.status;
    }
    if (filters.typology) {
      clauses.push('l.typology = @typology');
      params.typology = filters.typology;
    }
    if (filters.playbook_ref) {
      clauses.push('t.playbook_ref = @playbook_ref');
      params.playbook_ref = filters.playbook_ref;
    }
    if (filters.junior_name) {
      clauses.push('t.junior_name = @junior_name');
      params.junior_name = filters.junior_name;
    }
    if (filters.senior_name) {
      clauses.push('t.senior_name = @senior_name');
      params.senior_name = filters.senior_name;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT l.*, t.junior_name, t.senior_name, t.playbook_ref
         FROM lessons l JOIN traces t ON t.id = l.trace_id
         ${where}
         ORDER BY l.created_at DESC`
      )
      .all(params) as LessonRow[];
    return rows.map(rowToLesson);
  }

  edit(id: string, changes: LessonEdit): LessonWithTrace {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    const next = {
      quote: changes.quote ?? current.quote,
      what_changed: changes.what_changed ?? current.what_changed,
      why_it_matters: changes.why_it_matters ?? current.why_it_matters,
      typology: changes.typology ?? current.typology,
      status: changes.status ?? current.status,
    };
    const quote_verified =
      changes.quote === undefined
        ? current.quote_verified
        : next.quote.length > 0 && this.beforeTextForLesson(id).includes(next.quote);
    this.db
      .prepare(
        `UPDATE lessons SET quote = @quote, quote_verified = @quote_verified, what_changed = @what_changed, why_it_matters = @why_it_matters, typology = @typology, status = @status WHERE id = @id`
      )
      .run({ id, ...next, quote_verified: quote_verified ? 1 : 0 });
    return this.getById(id)!;
  }

  promote(id: string, payload: PromotePayload): LessonWithTrace {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    if (current.status !== 'pending_review') {
      throw new Error(`Lesson ${id} cannot be promoted from status '${current.status}'`);
    }
    if (!payload.reviewer.trim()) {
      throw new Error('Reviewer is required');
    }
    const next = {
      quote: payload.quote ?? current.quote,
      what_changed: payload.what_changed ?? current.what_changed,
      why_it_matters: payload.why_it_matters ?? current.why_it_matters,
      typology: payload.typology ?? current.typology,
    };
    const quote_verified =
      payload.quote === undefined
        ? current.quote_verified
        : next.quote.length > 0 && this.beforeTextForLesson(id).includes(next.quote);
    this.db
      .prepare(
        `UPDATE lessons SET quote = @quote, quote_verified = @quote_verified, what_changed = @what_changed, why_it_matters = @why_it_matters, typology = @typology,
         status = 'promoted', reviewer = @reviewer, reviewed_at = @now, promoted_at = @now WHERE id = @id`
      )
      .run({ id, ...next, quote_verified: quote_verified ? 1 : 0, reviewer: payload.reviewer.trim(), now: new Date().toISOString() });
    return this.getById(id)!;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run --cwd backend test`
Expected: PASS (11 tests passed: 3 in `TraceRepository`, 8 in `LessonRepository`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db.ts backend/src/repositories/traceRepository.ts backend/src/repositories/lessonRepository.ts backend/test/repositories.test.ts
git commit -m "Add SQLite schema and trace/lesson repositories"
```

---

### Task 3: Quote verification

**Files:**
- Create: `backend/src/extraction.ts`
- Test: `backend/test/extraction.test.ts`

**Interfaces:**
- Produces: `verifyQuote(quote: string, beforeText: string): boolean` — used by `TraceService.extract` in Task 5.

- [ ] **Step 1: Write the failing test**

Create `backend/test/extraction.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { verifyQuote } from '../src/extraction.js';

describe('verifyQuote', () => {
  it('verifies an exact substring match', () => {
    expect(verifyQuote('shall indemnify', 'The party shall indemnify all losses.')).toBe(true);
  });

  it('fails when the quote is not present', () => {
    expect(verifyQuote('shall not indemnify', 'The party shall indemnify all losses.')).toBe(false);
  });

  it('is sensitive to whitespace differences', () => {
    expect(verifyQuote('shall  indemnify', 'The party shall indemnify all losses.')).toBe(false);
  });

  it('does not verify an empty quote', () => {
    expect(verifyQuote('', 'The party shall indemnify all losses.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd backend test extraction`
Expected: FAIL — `Cannot find module '../src/extraction.js'`.

- [ ] **Step 3: Create `backend/src/extraction.ts`**

```typescript
export function verifyQuote(quote: string, beforeText: string): boolean {
  return quote.length > 0 && beforeText.includes(quote);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --cwd backend test extraction`
Expected: PASS (4 tests passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/extraction.ts backend/test/extraction.test.ts
git commit -m "Add code-side quote verification"
```

---

### Task 4: Domain profile loader

**Files:**
- Create: `backend/src/domain.ts`
- Create: `domain.md` (repo root)
- Test: `backend/test/domain.test.ts`

**Interfaces:**
- Produces: `interface DomainProfile { raw: string; typology_categories: string[] }`; `loadDomainProfile(path: string): DomainProfile`; `parseTypologyCategories(raw: string): string[]`. Used by `TraceService` (Task 5), `mcp/prompts.ts` (Task 8), and `context.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/domain.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDomainProfile, parseTypologyCategories } from '../src/domain.js';

describe('parseTypologyCategories', () => {
  it('extracts category names from the Typology section', () => {
    const raw = `# Domain\nSome text.\n\n# Typology\n- architecture: Structural decisions.\n- correctness: Does it work.\n\n# What counts as mentorship-worthy\nAnything.\n`;
    expect(parseTypologyCategories(raw)).toEqual(['architecture', 'correctness']);
  });

  it('returns an empty array when there is no Typology section', () => {
    expect(parseTypologyCategories('# Domain\nJust a domain.\n')).toEqual([]);
  });
});

describe('loadDomainProfile', () => {
  it('loads categories from a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-domain-'));
    const path = join(dir, 'domain.md');
    writeFileSync(
      path,
      '# Domain\nAudit practice.\n\n# Typology\n- materiality: Judgment on what is material.\n\n# What counts as mentorship-worthy\nMateriality calls.\n'
    );
    const profile = loadDomainProfile(path);
    expect(profile.typology_categories).toEqual(['materiality']);
  });

  it('falls back to the default legal profile when the file is missing', () => {
    const profile = loadDomainProfile('/nonexistent/domain.md');
    expect(profile.typology_categories).toContain('substantive_risk');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test domain`
Expected: FAIL — `Cannot find module '../src/domain.js'`.

- [ ] **Step 3: Create `backend/src/domain.ts`**

```typescript
import { readFileSync } from 'node:fs';

export interface DomainProfile {
  raw: string;
  typology_categories: string[];
}

const DEFAULT_PROFILE = `# Domain
A general legal practice reviewing contracts and client work product.

# Typology
- playbook_compliance: The edit enforces a documented firm playbook/style-guide rule.
- editorial_style: A stylistic or formatting preference with no risk or playbook basis.
- substantive_risk: A legal risk or liability judgment call.
- clarity_precision: The edit resolves ambiguity or tightens vague drafting.
- other: Doesn't fit the above.

# What counts as mentorship-worthy
Capture edits that reflect a real judgment call - a risk tradeoff, a
playbook rule being applied, or a drafting principle. Skip pure typo
fixes, whitespace/formatting-only changes, and edits with no
identifiable reasoning behind them.
`;

export function loadDomainProfile(path: string): DomainProfile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    raw = DEFAULT_PROFILE;
  }
  return { raw, typology_categories: parseTypologyCategories(raw) };
}

export function parseTypologyCategories(raw: string): string[] {
  const section = raw.split(/^# Typology\s*$/m)[1];
  if (!section) return [];
  const body = section.split(/^# /m)[0];
  const categories: string[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^-\s*([a-zA-Z0-9_]+)\s*:/);
    if (match) categories.push(match[1]);
  }
  return categories;
}
```

- [ ] **Step 4: Create the shipped `domain.md` at the repo root**

Create `/domain.md` (repo root, not inside `backend/`) with exactly the same content as `DEFAULT_PROFILE` above:

```markdown
# Domain
A general legal practice reviewing contracts and client work product.

# Typology
- playbook_compliance: The edit enforces a documented firm playbook/style-guide rule.
- editorial_style: A stylistic or formatting preference with no risk or playbook basis.
- substantive_risk: A legal risk or liability judgment call.
- clarity_precision: The edit resolves ambiguity or tightens vague drafting.
- other: Doesn't fit the above.

# What counts as mentorship-worthy
Capture edits that reflect a real judgment call - a risk tradeoff, a
playbook rule being applied, or a drafting principle. Skip pure typo
fixes, whitespace/formatting-only changes, and edits with no
identifiable reasoning behind them.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd backend test domain`
Expected: PASS (4 tests passed).

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain.ts backend/test/domain.test.ts domain.md
git commit -m "Add domain profile loader with legal example default"
```

---

### Task 5: Core service layer

**Files:**
- Create: `backend/src/services/traceService.ts`
- Create: `backend/src/services/lessonService.ts`
- Test: `backend/test/services.test.ts`

**Interfaces:**
- Consumes: `TraceRepository`, `LessonRepository` (Task 2), `verifyQuote` (Task 3), `DomainProfile` (Task 4), and the types from Task 1.
- Produces: `class TraceService` with `capture(input: NewTrace): Trace`, `get(id: string): Trace | undefined`, `list(status?: TraceStatus): Trace[]`, `skip(id: string, reason: string): Trace`, `extract(input: NewExtraction): LessonWithTrace`. `class LessonService` with `list(filters: LessonFilters): LessonWithTrace[]`, `get(id: string): LessonWithTrace | undefined`, `review(id: string, changes: LessonEdit): LessonWithTrace`, `promote(id: string, payload: PromotePayload): LessonWithTrace`. Both are consumed by the MCP tools (Task 6) and REST routes (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/services.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';

describe('TraceService + LessonService', () => {
  let db: Database;
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    traceService = new TraceService(traceRepo, lessonRepo, profile);
    lessonService = new LessonService(lessonRepo, profile);
  });

  it('extracts a lesson and marks the trace extracted, verifying the quote', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
      before_text: 'The party shall indemnify all losses without limit.',
      after_text: 'The party shall indemnify losses capped at fees paid.',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'indemnify all losses without limit',
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Uncapped indemnities expose the client to unlimited liability.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(true);
    expect(traceService.get(trace.id)?.status).toBe('extracted');
  });

  it('flags an unverifiable quote instead of rejecting the extraction', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'The party shall indemnify all losses.',
      after_text: 'The party shall indemnify losses capped at fees paid.',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'text that is not in the original',
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(false);
  });

  it('rejects an extraction with a typology outside the domain profile', () => {
    const trace = traceService.capture({ submitted_by: 'Jane', submitted_by_role: 'junior', before_text: 'a', after_text: 'b' });
    expect(() =>
      traceService.extract({
        trace_id: trace.id,
        quote: 'a',
        what_changed: 'x',
        why_it_matters: 'y',
        typology: 'not_a_real_category',
      })
    ).toThrow(/Unknown typology/);
  });

  it('refuses to extract more than one lesson for the same trace', () => {
    const trace = traceService.capture({ submitted_by: 'Jane', submitted_by_role: 'junior', before_text: 'a', after_text: 'b' });
    traceService.extract({
      trace_id: trace.id,
      quote: 'a',
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'other',
    });
    expect(() =>
      traceService.extract({
        trace_id: trace.id,
        quote: 'a',
        what_changed: 'x again',
        why_it_matters: 'y again',
        typology: 'other',
      })
    ).toThrow(/already extracted/);
  });

  it('skips a trace with a reason instead of extracting', () => {
    const trace = traceService.capture({ submitted_by: 'Jane', submitted_by_role: 'junior', before_text: 'a', after_text: 'a ' });
    const skipped = traceService.skip(trace.id, 'Whitespace-only change, not a judgment call.');
    expect(skipped.status).toBe('skipped');
    expect(skipped.skip_reason).toContain('Whitespace-only');
  });

  it('promotes through the lesson service after review', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'The party shall indemnify all losses.',
      after_text: 'The party shall indemnify losses capped at fees paid.',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'indemnify all losses',
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    const promoted = lessonService.promote(lesson.id, { reviewer: 'Sarah' });
    expect(promoted.status).toBe('promoted');
    expect(lessonService.list({ status: 'promoted' })).toHaveLength(1);
  });

  it('rejects review edits with a typology outside the domain profile', () => {
    const trace = traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(() => lessonService.review(lesson.id, { typology: 'not_a_real_category' })).toThrow(/Unknown typology/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test services`
Expected: FAIL — `Cannot find module '../src/services/traceService.js'`.

- [ ] **Step 3: Create `backend/src/services/traceService.ts`**

```typescript
import type { TraceRepository } from '../repositories/traceRepository.js';
import type { LessonRepository } from '../repositories/lessonRepository.js';
import type { DomainProfile } from '../domain.js';
import { verifyQuote } from '../extraction.js';
import type { LessonWithTrace, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceService {
  constructor(
    private traces: TraceRepository,
    private lessons: LessonRepository,
    private domainProfile: DomainProfile
  ) {}

  capture(input: NewTrace): Trace {
    return this.traces.create(input);
  }

  get(id: string): Trace | undefined {
    return this.traces.getById(id);
  }

  list(status?: TraceStatus): Trace[] {
    return this.traces.list(status);
  }

  skip(id: string, reason: string): Trace {
    const trace = this.traces.getById(id);
    if (!trace) throw new Error(`Trace not found: ${id}`);
    this.traces.markSkipped(id, reason);
    return this.traces.getById(id)!;
  }

  extract(input: NewExtraction): LessonWithTrace {
    const trace = this.traces.getById(input.trace_id);
    if (!trace) throw new Error(`Trace not found: ${input.trace_id}`);
    if (trace.status !== 'captured') {
      throw new Error(`Trace ${input.trace_id} was already ${trace.status}`);
    }
    if (this.lessons.getByTraceId(input.trace_id)) {
      throw new Error(`Trace ${input.trace_id} already extracted`);
    }
    if (!this.domainProfile.typology_categories.includes(input.typology)) {
      throw new Error(
        `Unknown typology '${input.typology}'. Valid categories: ${this.domainProfile.typology_categories.join(', ')}`
      );
    }
    const quote_verified = verifyQuote(input.quote, trace.before_text);
    const lesson = this.lessons.create({ ...input, quote_verified });
    this.traces.markExtracted(input.trace_id);
    return lesson;
  }
}
```

- [ ] **Step 4: Create `backend/src/services/lessonService.ts`**

```typescript
import type { LessonRepository } from '../repositories/lessonRepository.js';
import type { DomainProfile } from '../domain.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, PromotePayload } from '../types.js';

export class LessonService {
  constructor(
    private lessons: LessonRepository,
    private domainProfile: DomainProfile
  ) {}

  list(filters: LessonFilters): LessonWithTrace[] {
    return this.lessons.list(filters);
  }

  get(id: string): LessonWithTrace | undefined {
    return this.lessons.getById(id);
  }

  review(id: string, changes: LessonEdit): LessonWithTrace {
    this.validateTypology(changes.typology);
    return this.lessons.edit(id, changes);
  }

  promote(id: string, payload: PromotePayload): LessonWithTrace {
    this.validateTypology(payload.typology);
    return this.lessons.promote(id, payload);
  }

  private validateTypology(typology: string | undefined): void {
    if (typology && !this.domainProfile.typology_categories.includes(typology)) {
      throw new Error(`Unknown typology '${typology}'. Valid categories: ${this.domainProfile.typology_categories.join(', ')}`);
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd backend test services`
Expected: PASS (7 tests passed).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/traceService.ts backend/src/services/lessonService.ts backend/test/services.test.ts
git commit -m "Add core TraceService/LessonService business logic"
```

---

### Task 6: MCP server with data-layer tools

**Files:**
- Create: `backend/src/context.ts`
- Create: `backend/src/mcp/tools.ts`
- Create: `backend/src/mcp/server.ts`
- Test: `backend/test/tools.test.ts`

**Interfaces:**
- Consumes: `TraceService`, `LessonService` (Task 5), `openDb` (Task 2), `loadDomainProfile` (Task 4), `TraceServiceLike`, `LessonServiceLike` (Task 1).
- Produces: `interface AppContext { traceService: TraceService; lessonService: LessonService; domainProfile: DomainProfile }`; `buildContext(): AppContext`; `interface ToolContext { traceService: TraceServiceLike; lessonService: LessonServiceLike }`; `toToolContext(ctx: AppContext): ToolContext`; async handler functions `captureTraceHandler`, `getTraceHandler`, `skipExtractionHandler`, `saveExtractionHandler`, `listLessonsHandler`, `reviewLessonHandler`, `promoteLessonHandler`; `registerTools(server: FastMCP, ctx: ToolContext): void`; `createMcpServer(ctx: ToolContext, domainProfile: DomainProfile): FastMCP`. Used by `cli.ts` (Task 10) and extended by Task 7 (ask tools) and Task 8 (prompts).

`ToolContext` is typed against `TraceServiceLike` / `LessonServiceLike`, not the concrete `TraceService` / `LessonService` classes, and every handler is `async` even though the local implementation underneath is synchronous SQLite — Task 15 adds a second, remote (HTTP, genuinely async) implementation of the same interfaces, and both need to work through the exact same handler code without a rewrite.

- [ ] **Step 1: Create `backend/src/context.ts`**

```typescript
import { openDb } from './db.js';
import { TraceRepository } from './repositories/traceRepository.js';
import { LessonRepository } from './repositories/lessonRepository.js';
import { TraceService } from './services/traceService.js';
import { LessonService } from './services/lessonService.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';
import type { ToolContext } from './mcp/tools.js';

export interface AppContext {
  traceService: TraceService;
  lessonService: LessonService;
  domainProfile: DomainProfile;
}

export function buildContext(): AppContext {
  const dbPath = process.env.DB_PATH ?? './data/birdie.db';
  const domainProfilePath = process.env.DOMAIN_PROFILE_PATH ?? './domain.md';
  const db = openDb(dbPath);
  const traceRepo = new TraceRepository(db);
  const lessonRepo = new LessonRepository(db);
  const domainProfile = loadDomainProfile(domainProfilePath);
  return {
    traceService: new TraceService(traceRepo, lessonRepo, domainProfile),
    lessonService: new LessonService(lessonRepo, domainProfile),
    domainProfile,
  };
}

// Wraps the (synchronous) local AppContext services in async-returning adapters so they
// satisfy ToolContext (TraceServiceLike / LessonServiceLike, Task 1) the same way a remote
// HTTP-backed implementation does (Task 15). Awaiting a non-Promise value in an async
// function is a no-op in JS - this adds no real asynchrony for the local case.
export function toToolContext(ctx: AppContext): ToolContext {
  return {
    traceService: {
      capture: async (input) => ctx.traceService.capture(input),
      get: async (id) => ctx.traceService.get(id),
      list: async (status) => ctx.traceService.list(status),
      skip: async (id, reason) => ctx.traceService.skip(id, reason),
      extract: async (input) => ctx.traceService.extract(input),
    },
    lessonService: {
      list: async (filters) => ctx.lessonService.list(filters),
      get: async (id) => ctx.lessonService.get(id),
      review: async (id, changes) => ctx.lessonService.review(id, changes),
      promote: async (id, payload) => ctx.lessonService.promote(id, payload),
      askSeniorApproach: async (question, seniorName) => ctx.lessonService.askSeniorApproach(question, seniorName),
      askJuniorStruggles: async (juniorName) => ctx.lessonService.askJuniorStruggles(juniorName),
    },
  };
}
```

- [ ] **Step 2: Write the failing tool handler tests**

Create `backend/test/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';
import { toToolContext } from '../src/context.js';
import {
  captureTraceHandler,
  getTraceHandler,
  saveExtractionHandler,
  skipExtractionHandler,
  promoteLessonHandler,
  type ToolContext,
} from '../src/mcp/tools.js';

describe('MCP tool handlers', () => {
  let db: Database;
  let ctx: ToolContext;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    ctx = toToolContext({
      traceService: new TraceService(traceRepo, lessonRepo, profile),
      lessonService: new LessonService(lessonRepo, profile),
      domainProfile: profile,
    });
  });

  it('captures a trace and reads it back via get_trace', async () => {
    const trace = await captureTraceHandler(ctx, {
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    const fetched = await getTraceHandler(ctx, { trace_id: trace.id });
    expect(fetched.before_text).toBe('uncapped indemnity');
  });

  it('saves an extraction and then promotes it', async () => {
    const trace = await captureTraceHandler(ctx, {
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
    });
    const lesson = await saveExtractionHandler(ctx, {
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(true);
    const promoted = await promoteLessonHandler(ctx, { lesson_id: lesson.id, reviewer: 'Sarah' });
    expect(promoted.status).toBe('promoted');
  });

  it('skips a trace instead of extracting when not mentorship-worthy', async () => {
    const trace = await captureTraceHandler(ctx, {
      before_text: 'teh',
      after_text: 'the',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    const skipped = await skipExtractionHandler(ctx, { trace_id: trace.id, reason: 'Typo fix only.' });
    expect(skipped.status).toBe('skipped');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run --cwd backend test tools`
Expected: FAIL — `Cannot find module '../src/mcp/tools.js'`.

- [ ] **Step 4: Create `backend/src/mcp/tools.ts`**

```typescript
import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { TraceServiceLike, LessonServiceLike } from '../types.js';

export interface ToolContext {
  traceService: TraceServiceLike;
  lessonService: LessonServiceLike;
}

export const captureTraceParams = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  submitted_by: z.string().min(1),
  submitted_by_role: z.enum(['senior', 'junior']),
  junior_name: z.string().optional(),
  senior_name: z.string().optional(),
  playbook_ref: z.string().optional(),
  playbook_text: z.string().optional(),
  context_note: z.string().optional(),
});

export const getTraceParams = z.object({ trace_id: z.string().min(1) });

export const skipExtractionParams = z.object({
  trace_id: z.string().min(1),
  reason: z.string().min(1),
});

export const saveExtractionParams = z.object({
  trace_id: z.string().min(1),
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
  typology: z.string().min(1),
  playbook_alignment: z.enum(['aligned', 'diverges', 'not_applicable']).optional(),
  playbook_note: z.string().optional(),
});

export const listLessonsParams = z.object({
  status: z.enum(['pending_review', 'rejected', 'promoted']).optional(),
  typology: z.string().optional(),
  playbook_ref: z.string().optional(),
  junior_name: z.string().optional(),
  senior_name: z.string().optional(),
});

export const reviewLessonParams = z.object({
  lesson_id: z.string().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});

export const promoteLessonParams = z.object({
  lesson_id: z.string().min(1),
  reviewer: z.string().trim().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
});

export async function captureTraceHandler(ctx: ToolContext, args: z.infer<typeof captureTraceParams>) {
  return ctx.traceService.capture(args);
}

export async function getTraceHandler(ctx: ToolContext, args: z.infer<typeof getTraceParams>) {
  const trace = await ctx.traceService.get(args.trace_id);
  if (!trace) throw new Error(`Trace not found: ${args.trace_id}`);
  return trace;
}

export async function skipExtractionHandler(ctx: ToolContext, args: z.infer<typeof skipExtractionParams>) {
  return ctx.traceService.skip(args.trace_id, args.reason);
}

export async function saveExtractionHandler(ctx: ToolContext, args: z.infer<typeof saveExtractionParams>) {
  return ctx.traceService.extract(args);
}

export async function listLessonsHandler(ctx: ToolContext, args: z.infer<typeof listLessonsParams>) {
  return ctx.lessonService.list(args);
}

export async function reviewLessonHandler(ctx: ToolContext, args: z.infer<typeof reviewLessonParams>) {
  const { lesson_id, reject, ...fields } = args;
  return ctx.lessonService.review(lesson_id, { ...fields, status: reject ? 'rejected' : undefined });
}

export async function promoteLessonHandler(ctx: ToolContext, args: z.infer<typeof promoteLessonParams>) {
  const { lesson_id, ...payload } = args;
  return ctx.lessonService.promote(lesson_id, payload);
}

export function registerTools(server: FastMCP, ctx: ToolContext): void {
  server.addTool({
    name: 'capture_trace',
    description: 'Capture a before/after edit as a trace for later extraction into a mentorship lesson.',
    parameters: captureTraceParams,
    execute: async (args) => JSON.stringify(await captureTraceHandler(ctx, args)),
  });
  server.addTool({
    name: 'get_trace',
    description: "Read a trace's before/after/playbook text to reason over before extracting a lesson.",
    parameters: getTraceParams,
    execute: async (args) => JSON.stringify(await getTraceHandler(ctx, args)),
  });
  server.addTool({
    name: 'skip_extraction',
    description: 'Mark a trace as not mentorship-worthy instead of forcing a lesson out of it.',
    parameters: skipExtractionParams,
    execute: async (args) => JSON.stringify(await skipExtractionHandler(ctx, args)),
  });
  server.addTool({
    name: 'save_extraction',
    description: 'Persist an extracted lesson: quote, what changed, why it matters, typology, and playbook alignment.',
    parameters: saveExtractionParams,
    execute: async (args) => JSON.stringify(await saveExtractionHandler(ctx, args)),
  });
  server.addTool({
    name: 'list_lessons',
    description: 'List lessons, filterable by status, typology, playbook_ref, junior_name, senior_name.',
    parameters: listLessonsParams,
    execute: async (args) => JSON.stringify(await listLessonsHandler(ctx, args)),
  });
  server.addTool({
    name: 'review_lesson',
    description: 'Edit a pending lesson in place, or reject it.',
    parameters: reviewLessonParams,
    execute: async (args) => JSON.stringify(await reviewLessonHandler(ctx, args)),
  });
  server.addTool({
    name: 'promote_lesson',
    description: 'Promote a reviewed lesson into the shared pool, requiring a reviewer name.',
    parameters: promoteLessonParams,
    execute: async (args) => JSON.stringify(await promoteLessonHandler(ctx, args)),
  });
}
```

- [ ] **Step 5: Create `backend/src/mcp/server.ts`**

```typescript
import { FastMCP } from 'fastmcp';
import { registerTools, type ToolContext } from './tools.js';
import type { DomainProfile } from '../domain.js';

export function createMcpServer(ctx: ToolContext, domainProfile: DomainProfile): FastMCP {
  const server = new FastMCP({ name: 'birdie', version: '0.1.0' });
  registerTools(server, ctx);
  void domainProfile; // wired into prompts.ts in Task 8
  return server;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run --cwd backend test tools`
Expected: PASS (3 tests passed).

- [ ] **Step 7: Commit**

```bash
git add backend/src/context.ts backend/src/mcp/tools.ts backend/src/mcp/server.ts backend/test/tools.test.ts
git commit -m "Add MCP server with data-layer tools (capture/get/skip/save/list/review/promote)"
```

---

### Task 7: Ask tools (senior-approach / junior-struggles)

**Files:**
- Modify: `backend/src/repositories/lessonRepository.ts` (add `searchPromoted`, `strugglesFor`)
- Modify: `backend/src/services/lessonService.ts` (add `askSeniorApproach`, `askJuniorStruggles`)
- Modify: `backend/src/mcp/tools.ts` (add `ask_senior_approach`, `ask_junior_struggles` tools)
- Test: `backend/test/ask.test.ts`

**Interfaces:**
- Produces (added to `LessonRepository`): `searchPromoted(question: string, senior_name?: string): LessonWithTrace[]`, `strugglesFor(junior_name?: string): { lessons: LessonWithTrace[]; typology_counts: Record<string, number> }`.
- Produces (added to `LessonService`): `askSeniorApproach(question: string, senior_name?: string): LessonWithTrace[]`, `askJuniorStruggles(junior_name?: string): { lessons: LessonWithTrace[]; typology_counts: Record<string, number> }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/ask.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';

describe('ask_senior_approach / ask_junior_struggles', () => {
  let db: Database;
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    traceService = new TraceService(traceRepo, lessonRepo, profile);
    lessonService = new LessonService(lessonRepo, profile);

    const trace = traceService.capture({
      submitted_by: 'Sarah',
      submitted_by_role: 'senior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
      before_text: 'The party shall indemnify all losses without limit.',
      after_text: 'The party shall indemnify losses capped at fees paid.',
      playbook_ref: 'NDA §4.3',
    });
    const lesson = traceService.extract({
      trace_id: trace.id,
      quote: 'indemnify all losses without limit',
      what_changed: 'Capped the indemnity at fees paid.',
      why_it_matters: 'Uncapped indemnities expose the client to unlimited liability.',
      typology: 'substantive_risk',
    });
    lessonService.promote(lesson.id, { reviewer: 'Sarah' });
  });

  it('finds a promoted lesson by keyword and senior name', () => {
    const results = lessonService.askSeniorApproach('indemnity cap', 'Sarah');
    expect(results).toHaveLength(1);
    expect(results[0].why_it_matters).toContain('unlimited liability');
  });

  it('returns nothing for a senior with no matching promoted lessons', () => {
    expect(lessonService.askSeniorApproach('indemnity cap', 'Someone Else')).toHaveLength(0);
  });

  it('only searches promoted lessons, not pending ones', () => {
    const trace = traceService.capture({
      submitted_by: 'Sarah',
      submitted_by_role: 'senior',
      senior_name: 'Sarah',
      before_text: 'a governing law clause',
      after_text: 'a revised governing law clause',
    });
    traceService.extract({
      trace_id: trace.id,
      quote: 'a governing law clause',
      what_changed: 'Updated governing law.',
      why_it_matters: 'Jurisdiction preference.',
      typology: 'editorial_style',
    });
    expect(lessonService.askSeniorApproach('governing law', 'Sarah')).toHaveLength(0);
  });

  it('summarizes typology counts for a specific junior', () => {
    const result = lessonService.askJuniorStruggles('Jane');
    expect(result.typology_counts).toEqual({ substantive_risk: 1 });
    expect(result.lessons).toHaveLength(1);
  });

  it('returns no struggles for a junior with no promoted lessons', () => {
    const result = lessonService.askJuniorStruggles('Nobody');
    expect(result.lessons).toHaveLength(0);
    expect(result.typology_counts).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test ask`
Expected: FAIL — `lessonService.askSeniorApproach is not a function`.

- [ ] **Step 3: Add `searchPromoted` and `strugglesFor` to `backend/src/repositories/lessonRepository.ts`**

Add these two methods inside the `LessonRepository` class, after `promote`:

```typescript
  searchPromoted(question: string, senior_name?: string): LessonWithTrace[] {
    const keywords = question
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);
    const clauses = ["l.status = 'promoted'"];
    const params: Record<string, string> = {};
    if (senior_name) {
      clauses.push('t.senior_name = @senior_name');
      params.senior_name = senior_name;
    }
    if (keywords.length > 0) {
      const keywordClauses = keywords.map((kw, i) => {
        params[`kw${i}`] = `%${kw}%`;
        return `(l.quote LIKE @kw${i} OR l.what_changed LIKE @kw${i} OR l.why_it_matters LIKE @kw${i} OR t.playbook_ref LIKE @kw${i})`;
      });
      clauses.push(`(${keywordClauses.join(' OR ')})`);
    }
    const rows = this.db
      .prepare(
        `SELECT l.*, t.junior_name, t.senior_name, t.playbook_ref
         FROM lessons l JOIN traces t ON t.id = l.trace_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY l.promoted_at DESC`
      )
      .all(params) as LessonRow[];
    return rows.map(rowToLesson);
  }

  strugglesFor(junior_name?: string): { lessons: LessonWithTrace[]; typology_counts: Record<string, number> } {
    const clauses = ["l.status = 'promoted'"];
    const params: Record<string, string> = {};
    if (junior_name) {
      clauses.push('t.junior_name = @junior_name');
      params.junior_name = junior_name;
    }
    const rows = this.db
      .prepare(
        `SELECT l.*, t.junior_name, t.senior_name, t.playbook_ref
         FROM lessons l JOIN traces t ON t.id = l.trace_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY l.promoted_at DESC`
      )
      .all(params) as LessonRow[];
    const lessons = rows.map(rowToLesson);
    const typology_counts: Record<string, number> = {};
    for (const lesson of lessons) {
      typology_counts[lesson.typology] = (typology_counts[lesson.typology] ?? 0) + 1;
    }
    return { lessons, typology_counts };
  }
```

- [ ] **Step 4: Add `askSeniorApproach` and `askJuniorStruggles` to `backend/src/services/lessonService.ts`**

Add these two methods inside the `LessonService` class, after `promote`:

```typescript
  askSeniorApproach(question: string, senior_name?: string): LessonWithTrace[] {
    return this.lessons.searchPromoted(question, senior_name);
  }

  askJuniorStruggles(junior_name?: string): { lessons: LessonWithTrace[]; typology_counts: Record<string, number> } {
    return this.lessons.strugglesFor(junior_name);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd backend test ask`
Expected: PASS (5 tests passed).

- [ ] **Step 6: Add the two MCP tools to `backend/src/mcp/tools.ts`**

Add these zod schemas after `promoteLessonParams`:

```typescript
export const askSeniorApproachParams = z.object({
  question: z.string().min(1),
  senior_name: z.string().optional(),
});

export const askJuniorStrugglesParams = z.object({
  junior_name: z.string().optional(),
});
```

Add these handlers after `promoteLessonHandler`:

```typescript
export async function askSeniorApproachHandler(ctx: ToolContext, args: z.infer<typeof askSeniorApproachParams>) {
  return ctx.lessonService.askSeniorApproach(args.question, args.senior_name);
}

export async function askJuniorStrugglesHandler(ctx: ToolContext, args: z.infer<typeof askJuniorStrugglesParams>) {
  return ctx.lessonService.askJuniorStruggles(args.junior_name);
}
```

Add these two registrations inside `registerTools`, after the `promote_lesson` tool:

```typescript
  server.addTool({
    name: 'ask_senior_approach',
    description: 'Find promoted lessons matching a question, optionally filtered to one senior.',
    parameters: askSeniorApproachParams,
    execute: async (args) => JSON.stringify(await askSeniorApproachHandler(ctx, args)),
  });
  server.addTool({
    name: 'ask_junior_struggles',
    description: 'Summarize promoted lessons for a junior (or all juniors) with a typology breakdown.',
    parameters: askJuniorStrugglesParams,
    execute: async (args) => JSON.stringify(await askJuniorStrugglesHandler(ctx, args)),
  });
```

- [ ] **Step 7: Run the full backend test suite to verify nothing broke**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/lessonRepository.ts backend/src/services/lessonService.ts backend/src/mcp/tools.ts backend/test/ask.test.ts
git commit -m "Add ask_senior_approach and ask_junior_struggles MCP tools"
```

---

### Task 8: MCP prompts (the judgment layer)

**Files:**
- Create: `backend/src/mcp/prompts.ts`
- Modify: `backend/src/mcp/server.ts` (register prompts)
- Test: `backend/test/prompts.test.ts`

**Interfaces:**
- Consumes: `DomainProfile` (Task 4).
- Produces: `buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string`, `buildAskSeniorApproachPrompt(profile: DomainProfile, question: string, seniorName?: string): string`, `buildAskJuniorStrugglesPrompt(profile: DomainProfile, juniorName?: string): string`, `registerPrompts(server: FastMCP, profile: DomainProfile): void`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { buildExtractLessonPrompt, buildAskSeniorApproachPrompt, buildAskJuniorStrugglesPrompt } from '../src/mcp/prompts.js';
import { loadDomainProfile } from '../src/domain.js';

describe('MCP prompt builders', () => {
  const profile = loadDomainProfile('/nonexistent/domain.md');

  it('extract-lesson prompt references the trace id, skip option, and domain typology', () => {
    const prompt = buildExtractLessonPrompt(profile, 'trace-123');
    expect(prompt).toContain('trace_id="trace-123"');
    expect(prompt).toContain('substantive_risk');
    expect(prompt).toContain('skip_extraction');
  });

  it('ask-senior-approach prompt includes the question and optional senior filter', () => {
    const prompt = buildAskSeniorApproachPrompt(profile, 'How do I handle uncapped indemnities?', 'Sarah');
    expect(prompt).toContain('How do I handle uncapped indemnities?');
    expect(prompt).toContain('senior_name="Sarah"');
  });

  it('ask-junior-struggles prompt omits junior_name when not provided', () => {
    const prompt = buildAskJuniorStrugglesPrompt(profile);
    expect(prompt).toContain('no junior_name to see all juniors');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test prompts`
Expected: FAIL — `Cannot find module '../src/mcp/prompts.js'`.

- [ ] **Step 3: Create `backend/src/mcp/prompts.ts`**

```typescript
import type { FastMCP } from 'fastmcp';
import type { DomainProfile } from '../domain.js';

export function buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string {
  return `You are extracting a mentorship lesson from a captured trace (before/after edit).

${profile.raw}

Steps:
1. Call get_trace with trace_id="${traceId}" to read before_text, after_text, and playbook_text (if any).
2. Using the "What counts as mentorship-worthy" guidance above, decide whether this trace reflects a real judgment call worth capturing. If not, call skip_extraction with a short reason and stop.
3. If it is worth capturing, write:
   - quote: a VERBATIM excerpt copied exactly from before_text (not paraphrased).
   - what_changed: a concise summary of the edit.
   - why_it_matters: the reasoning behind the edit.
   - typology: exactly one of the category names listed under "# Typology" above.
   - If playbook_text was present, also set playbook_alignment ('aligned' | 'diverges' | 'not_applicable') and playbook_note. If it diverges, say so outright in playbook_note - don't soften it.
4. Call save_extraction with trace_id="${traceId}" and the fields above.`;
}

export function buildAskSeniorApproachPrompt(profile: DomainProfile, question: string, seniorName?: string): string {
  return `You are answering a junior's question about how a senior has approached a similar situation before.

${profile.raw}

1. Call ask_senior_approach with question=${JSON.stringify(question)}${seniorName ? ` and senior_name=${JSON.stringify(seniorName)}` : ''}.
2. Answer strictly from the lesson cards returned - quote the relevant why_it_matters and cite which lesson it came from.
3. If nothing relevant comes back, say so plainly. Do not invent an answer.`;
}

export function buildAskJuniorStrugglesPrompt(profile: DomainProfile, juniorName?: string): string {
  return `You are summarizing what a junior (or juniors in general) are struggling with, for a senior reviewing mentorship progress.

${profile.raw}

1. Call ask_junior_struggles${juniorName ? ` with junior_name=${JSON.stringify(juniorName)}` : ' with no junior_name to see all juniors'}.
2. Summarize the typology_counts breakdown in plain language, and cite 1-2 concrete example lessons for the most common category.
3. If there are no promoted lessons for this junior, say so plainly rather than guessing.`;
}

export function registerPrompts(server: FastMCP, profile: DomainProfile): void {
  server.addPrompt({
    name: 'extract-lesson',
    description: 'Extract a mentorship lesson from a captured trace, applying the domain profile.',
    arguments: [{ name: 'trace_id', description: 'The trace to extract from', required: true }],
    load: async (args: { trace_id: string }) => buildExtractLessonPrompt(profile, args.trace_id),
  });
  server.addPrompt({
    name: 'ask-senior-approach',
    description: 'Answer how a senior (or seniors in general) handled a similar situation.',
    arguments: [
      { name: 'question', description: "The junior's question", required: true },
      { name: 'senior_name', description: 'Optional: a specific senior to ask about', required: false },
    ],
    load: async (args: { question: string; senior_name?: string }) =>
      buildAskSeniorApproachPrompt(profile, args.question, args.senior_name),
  });
  server.addPrompt({
    name: 'ask-junior-struggles',
    description: 'Summarize what a junior (or juniors in general) are struggling with.',
    arguments: [{ name: 'junior_name', description: 'Optional: a specific junior to ask about', required: false }],
    load: async (args: { junior_name?: string }) => buildAskJuniorStrugglesPrompt(profile, args.junior_name),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd backend test prompts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Wire prompts into the MCP server**

In `backend/src/mcp/server.ts`, replace the whole file with:

```typescript
import { FastMCP } from 'fastmcp';
import { registerTools, type ToolContext } from './tools.js';
import { registerPrompts } from './prompts.js';
import type { DomainProfile } from '../domain.js';

export function createMcpServer(ctx: ToolContext, domainProfile: DomainProfile): FastMCP {
  const server = new FastMCP({ name: 'birdie', version: '0.1.0' });
  registerTools(server, ctx);
  registerPrompts(server, domainProfile);
  return server;
}
```

- [ ] **Step 6: Run the full backend test suite**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 7: Commit**

```bash
git add backend/src/mcp/prompts.ts backend/src/mcp/server.ts backend/test/prompts.test.ts
git commit -m "Add MCP prompts: extract-lesson, ask-senior-approach, ask-junior-struggles"
```

---

### Task 9: REST API

**Files:**
- Create: `backend/src/routes/traces.ts`
- Create: `backend/src/routes/lessons.ts`
- Create: `backend/src/server.ts`
- Test: `backend/test/routes.test.ts`

**Interfaces:**
- Consumes: `AppContext` (Task 6), `TraceService`, `LessonService` (Task 5).
- Produces: `tracesRouter(ctx: AppContext): Router`, `lessonsRouter(ctx: AppContext): Router`, `createServer(ctx: AppContext): Express`. Also exposes `GET /domain` so the web UI can render the active typology categories from `domain.md`. Used by `cli.ts` (Task 10).

- [ ] **Step 1: Write the failing REST tests**

Create `backend/test/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import request from 'supertest';
import type { Express } from 'express';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';
import { createServer } from '../src/server.js';
import type { AppContext } from '../src/context.js';

function buildTestContext(): AppContext {
  const db = openDb(':memory:');
  const traceRepo = new TraceRepository(db);
  const lessonRepo = new LessonRepository(db);
  const domainProfile = loadDomainProfile('/nonexistent/domain.md');
  return {
    traceService: new TraceService(traceRepo, lessonRepo, domainProfile),
    lessonService: new LessonService(lessonRepo, domainProfile),
    domainProfile,
  };
}

describe('REST API', () => {
  let app: Express;
  let ctx: AppContext;

  beforeEach(() => {
    ctx = buildTestContext();
    app = createServer(ctx);
  });

  it('captures a trace via POST /traces', async () => {
    const res = await request(app).post('/traces').send({
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('captured');
  });

  it('rejects an invalid trace body with 400', async () => {
    const res = await request(app).post('/traces').send({ before_text: 'x' });
    expect(res.status).toBe(400);
  });

  it('lists and fetches lessons, and promotes one', async () => {
    const trace = ctx.traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = ctx.traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });

    const list = await request(app).get('/lessons?status=pending_review');
    expect(list.body).toHaveLength(1);

    const promote = await request(app).post(`/lessons/${lesson.id}/promote`).send({ reviewer: 'Sarah' });
    expect(promote.status).toBe(200);
    expect(promote.body.status).toBe('promoted');
  });

  it('returns 404 for a lesson that does not exist', async () => {
    const res = await request(app).get('/lessons/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('returns the active domain profile categories', async () => {
    const res = await request(app).get('/domain');
    expect(res.status).toBe(200);
    expect(res.body.typology_categories).toContain('substantive_risk');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test routes`
Expected: FAIL — `Cannot find module '../src/server.js'`.

- [ ] **Step 3: Create `backend/src/routes/traces.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const createTraceBody = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  submitted_by: z.string().min(1),
  submitted_by_role: z.enum(['senior', 'junior']),
  junior_name: z.string().optional(),
  senior_name: z.string().optional(),
  playbook_ref: z.string().optional(),
  playbook_text: z.string().optional(),
  context_note: z.string().optional(),
});
const traceStatusQuery = z.enum(['captured', 'extracted', 'skipped']).optional();

export function tracesRouter(ctx: AppContext): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const parsed = createTraceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const trace = ctx.traceService.capture(parsed.data);
    res.status(201).json(trace);
  });

  router.get('/', (req, res) => {
    const parsed = traceStatusQuery.safeParse(req.query.status);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(ctx.traceService.list(parsed.data));
  });

  router.get('/:id', (req, res) => {
    const trace = ctx.traceService.get(req.params.id);
    if (!trace) {
      res.status(404).json({ error: 'Trace not found' });
      return;
    }
    res.json(trace);
  });

  return router;
}
```

- [ ] **Step 4: Create `backend/src/routes/lessons.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const editLessonBody = z.object({
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});

const promoteLessonBody = z.object({
  reviewer: z.string().trim().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
});
const lessonStatusQuery = z.enum(['pending_review', 'rejected', 'promoted']).optional();

export function lessonsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { status, typology, playbook_ref, junior_name, senior_name } = req.query;
    const parsedStatus = lessonStatusQuery.safeParse(status);
    if (!parsedStatus.success) {
      res.status(400).json({ error: parsedStatus.error.message });
      return;
    }
    res.json(
      ctx.lessonService.list({
        status: parsedStatus.data,
        typology: typology as string | undefined,
        playbook_ref: playbook_ref as string | undefined,
        junior_name: junior_name as string | undefined,
        senior_name: senior_name as string | undefined,
      })
    );
  });

  router.get('/:id', (req, res) => {
    const lesson = ctx.lessonService.get(req.params.id);
    if (!lesson) {
      res.status(404).json({ error: 'Lesson not found' });
      return;
    }
    res.json(lesson);
  });

  router.patch('/:id', (req, res) => {
    const parsed = editLessonBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { reject, ...fields } = parsed.data;
    try {
      const lesson = ctx.lessonService.review(req.params.id, { ...fields, status: reject ? 'rejected' : undefined });
      res.json(lesson);
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  router.post('/:id/promote', (req, res) => {
    const parsed = promoteLessonBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const lesson = ctx.lessonService.promote(req.params.id, parsed.data);
      res.json(lesson);
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  return router;
}
```

- [ ] **Step 5: Create `backend/src/server.ts`**

```typescript
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from './context.js';
import { tracesRouter } from './routes/traces.js';
import { lessonsRouter } from './routes/lessons.js';

export function createServer(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());
  app.use('/traces', tracesRouter(ctx));
  app.use('/lessons', lessonsRouter(ctx));
  app.get('/domain', (_req, res) => {
    res.json({
      typology_categories: ctx.domainProfile.typology_categories,
    });
  });

  const webDist = findWebDist();
  if (webDist) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  return app;
}

function findWebDist(): string | undefined {
  const candidates = [
    process.env.WEB_DIST_PATH,
    resolve(process.cwd(), 'web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(join(path, 'index.html')));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run --cwd backend test routes`
Expected: PASS (5 tests passed).

- [ ] **Step 7: Run the full backend test suite**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files, backend done). These route tests do not require `web/dist`; static web serving is covered by the Task 11 smoke check after the web bundle exists.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/traces.ts backend/src/routes/lessons.ts backend/src/server.ts backend/test/routes.test.ts
git commit -m "Add REST API for traces and lessons (data-only, no AI reasoning)"
```

---

### Task 10: CLI entrypoint

**Files:**
- Create: `backend/src/cli.ts`

**Interfaces:**
- Consumes: `buildContext`, `toToolContext` (Task 6), `createServer` (Task 9), `createMcpServer` (Task 8).

- [ ] **Step 1: Create `backend/src/cli.ts`**

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { buildContext, toToolContext } from './context.js';
import { createServer } from './server.js';
import { createMcpServer } from './mcp/server.js';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'both';
  const ctx = buildContext();

  if (mode === 'web' || mode === 'both') {
    const port = Number(process.env.PORT ?? 4000);
    createServer(ctx).listen(port, () => {
      console.error(`Birdie REST API + web UI listening on http://localhost:${port}`);
    });
  }

  if (mode === 'mcp' || mode === 'both') {
    const server = createMcpServer(toToolContext(ctx), ctx.domainProfile);
    await server.start({ transportType: 'stdio' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

This `mcp` mode using `buildContext()` directly (always local, ignoring `~/.birdie/config.json`) is superseded by Task 15's `mcpContext.ts`, which is what a real plugin install uses; this task's manual CLI invocation stays useful for local development and the advanced/manual-registration path (§4.1) throughout.

- [ ] **Step 2: Verify the `web` mode starts and serves requests**

Run: `cd backend && DB_PATH=:memory: PORT=4001 bun src/cli.ts web`
Expected: prints `Birdie REST API + web UI listening on http://localhost:4001` and keeps running. At this point the REST API is available; the static web UI is served by the same process once Task 11 has created `web/dist`.

In a second terminal, run:

```bash
curl -s -X POST http://localhost:4001/traces \
  -H 'Content-Type: application/json' \
  -d '{"before_text":"uncapped indemnity","after_text":"capped indemnity","submitted_by":"Jane","submitted_by_role":"junior"}'
```

Expected: a JSON response with `"status":"captured"` and a generated `id`. Stop the server with Ctrl+C afterward.

- [ ] **Step 3: Verify the `mcp` mode starts without crashing**

Run: `cd backend && DB_PATH=:memory: bun src/cli.ts mcp`
Expected: the process starts and waits on stdio without throwing (no visible output is normal for a stdio MCP server with nothing connected). Stop it with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add backend/src/cli.ts
git commit -m "Add birdie CLI entrypoint (mcp / web / both run modes)"
```

---

### Task 11: Web UI — one page, two parts

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/api.ts`
- Create: `web/src/CaptureForm.tsx`
- Create: `web/src/ReviewList.tsx`
- Create: `web/src/App.tsx`

**Interfaces:**
- Consumes: the REST API from Task 9 (`POST /traces`, `GET /lessons`, `PATCH /lessons/:id`, `POST /lessons/:id/promote`, `GET /domain`) via `fetch`.
- No automated test suite for this task, per the design spec's testing scope (§12) — verified by a successful build and a manual smoke check.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "@birdie/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/traces': 'http://localhost:4000',
      '/lessons': 'http://localhost:4000',
    },
  },
});
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Birdie</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Create `web/src/api.ts`**

```typescript
export interface Trace {
  id: string;
  submitted_by: string;
  submitted_by_role: 'senior' | 'junior';
  junior_name: string | null;
  senior_name: string | null;
  before_text: string;
  after_text: string;
  playbook_ref: string | null;
  playbook_text: string | null;
  context_note: string | null;
  status: 'captured' | 'extracted' | 'skipped';
  skip_reason: string | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  trace_id: string;
  junior_name: string | null;
  senior_name: string | null;
  playbook_ref: string | null;
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment: 'aligned' | 'diverges' | 'not_applicable' | null;
  playbook_note: string | null;
  status: 'pending_review' | 'rejected' | 'promoted';
  reviewer: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  created_at: string;
}

export type NewTrace = Pick<Trace, 'before_text' | 'after_text' | 'submitted_by' | 'submitted_by_role'> &
  Partial<Pick<Trace, 'junior_name' | 'senior_name' | 'playbook_ref' | 'playbook_text' | 'context_note'>>;

export interface DomainProfile {
  typology_categories: string[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function captureTrace(input: NewTrace): Promise<Trace> {
  return fetch('/traces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => json<Trace>(res));
}

export function listLessons(status?: Lesson['status']): Promise<Lesson[]> {
  const query = status ? `?status=${status}` : '';
  return fetch(`/lessons${query}`).then((res) => json<Lesson[]>(res));
}

export function getDomainProfile(): Promise<DomainProfile> {
  return fetch('/domain').then((res) => json<DomainProfile>(res));
}

export function reviewLesson(
  id: string,
  changes: Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters' | 'typology'>> & { reject?: boolean }
): Promise<Lesson> {
  return fetch(`/lessons/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  }).then((res) => json<Lesson>(res));
}

export function promoteLesson(
  id: string,
  payload: { reviewer: string } & Partial<Pick<Lesson, 'quote' | 'what_changed' | 'why_it_matters' | 'typology'>>
): Promise<Lesson> {
  return fetch(`/lessons/${id}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => json<Lesson>(res));
}
```

- [ ] **Step 7: Create `web/src/CaptureForm.tsx`** (part 1 of the single page)

```typescript
import { useState } from 'react';
import { captureTrace } from './api.js';

interface Props {
  onCaptured: () => void;
}

export default function CaptureForm({ onCaptured }: Props) {
  const [beforeText, setBeforeText] = useState('');
  const [afterText, setAfterText] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [submittedByRole, setSubmittedByRole] = useState<'senior' | 'junior'>('senior');
  const [juniorName, setJuniorName] = useState('');
  const [seniorName, setSeniorName] = useState('');
  const [playbookRef, setPlaybookRef] = useState('');
  const [playbookText, setPlaybookText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('Saving...');
    try {
      const trace = await captureTrace({
        before_text: beforeText,
        after_text: afterText,
        submitted_by: submittedBy,
        submitted_by_role: submittedByRole,
        junior_name: juniorName || undefined,
        senior_name: seniorName || undefined,
        playbook_ref: playbookRef || undefined,
        playbook_text: playbookText || undefined,
      });
      setStatus(`Captured trace ${trace.id}. Ask your MCP-connected assistant to extract a lesson from it.`);
      setBeforeText('');
      setAfterText('');
      onCaptured();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Capture a trace</h2>
      <label>
        Before
        <textarea value={beforeText} onChange={(e) => setBeforeText(e.target.value)} required rows={4} />
      </label>
      <label>
        After
        <textarea value={afterText} onChange={(e) => setAfterText(e.target.value)} required rows={4} />
      </label>
      <label>
        Submitted by
        <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} required />
      </label>
      <label>
        Role
        <select value={submittedByRole} onChange={(e) => setSubmittedByRole(e.target.value as 'senior' | 'junior')}>
          <option value="senior">Senior</option>
          <option value="junior">Junior</option>
        </select>
      </label>
      <label>
        Junior name
        <input value={juniorName} onChange={(e) => setJuniorName(e.target.value)} />
      </label>
      <label>
        Senior name
        <input value={seniorName} onChange={(e) => setSeniorName(e.target.value)} />
      </label>
      <label>
        Playbook ref
        <input value={playbookRef} onChange={(e) => setPlaybookRef(e.target.value)} />
      </label>
      <label>
        Playbook text
        <textarea value={playbookText} onChange={(e) => setPlaybookText(e.target.value)} rows={3} />
      </label>
      <button type="submit">Capture</button>
      {status && <p>{status}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Create `web/src/ReviewList.tsx`** (part 2 of the single page)

```typescript
import { useEffect, useState } from 'react';
import { getDomainProfile, listLessons, promoteLesson, reviewLesson, type Lesson } from './api.js';

interface Props {
  refreshSignal: number;
}

export default function ReviewList({ refreshSignal }: Props) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [typologies, setTypologies] = useState<string[]>([]);
  const [reviewerById, setReviewerById] = useState<Record<string, string>>({});

  async function refresh() {
    setLessons(await listLessons('pending_review'));
  }

  useEffect(() => {
    getDomainProfile().then((profile) => setTypologies(profile.typology_categories));
    refresh();
  }, [refreshSignal]);

  async function handlePromote(lesson: Lesson) {
    const reviewer = reviewerById[lesson.id];
    if (!reviewer) {
      alert('Enter a reviewer name first.');
      return;
    }
    await promoteLesson(lesson.id, {
      reviewer,
      quote: lesson.quote,
      what_changed: lesson.what_changed,
      why_it_matters: lesson.why_it_matters,
      typology: lesson.typology,
    });
    await refresh();
  }

  async function handleReject(lesson: Lesson) {
    await reviewLesson(lesson.id, { reject: true });
    await refresh();
  }

  async function handleSaveDraft(lesson: Lesson) {
    await reviewLesson(lesson.id, {
      quote: lesson.quote,
      what_changed: lesson.what_changed,
      why_it_matters: lesson.why_it_matters,
      typology: lesson.typology,
    });
    await refresh();
  }

  function updateField(id: string, field: 'quote' | 'what_changed' | 'why_it_matters' | 'typology', value: string) {
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  return (
    <div>
      <h2>Review queue</h2>
      {lessons.length === 0 && <p>Nothing pending.</p>}
      {lessons.map((lesson) => (
        <div key={lesson.id} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}>
          {!lesson.quote_verified && <p style={{ color: 'darkred' }}>Quote not verified against the original text.</p>}
          {lesson.playbook_alignment === 'diverges' && (
            <p style={{ color: 'darkorange' }}>Diverges from playbook: {lesson.playbook_note}</p>
          )}
          <label>
            Quote
            <textarea value={lesson.quote} onChange={(e) => updateField(lesson.id, 'quote', e.target.value)} rows={2} />
          </label>
          <label>
            What changed
            <textarea
              value={lesson.what_changed}
              onChange={(e) => updateField(lesson.id, 'what_changed', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Why it matters
            <textarea
              value={lesson.why_it_matters}
              onChange={(e) => updateField(lesson.id, 'why_it_matters', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Typology
            <select value={lesson.typology} onChange={(e) => updateField(lesson.id, 'typology', e.target.value)}>
              {typologies.map((typology) => (
                <option key={typology} value={typology}>
                  {typology}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reviewer name
            <input
              value={reviewerById[lesson.id] ?? ''}
              onChange={(e) => setReviewerById((prev) => ({ ...prev, [lesson.id]: e.target.value }))}
            />
          </label>
          <button onClick={() => handlePromote(lesson)}>Confirm & Promote</button>
          <button onClick={() => handleSaveDraft(lesson)}>Save as Draft</button>
          <button onClick={() => handleReject(lesson)}>Reject</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Create `web/src/App.tsx`**

```typescript
import { useState } from 'react';
import CaptureForm from './CaptureForm.js';
import ReviewList from './ReviewList.js';

export default function App() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>Birdie</h1>
      <CaptureForm onCaptured={() => setRefreshSignal((n) => n + 1)} />
      <hr />
      <ReviewList refreshSignal={refreshSignal} />
    </div>
  );
}
```

- [ ] **Step 10: Install web dependencies and verify the build**

Run: `bun install` (from repo root — picks up the new `web` workspace)
Expected: installs succeed for the `web` workspace.

Run: `bun run --cwd web build`
Expected: `tsc -b && vite build` completes with no type errors, producing `web/dist/`.

- [ ] **Step 11: Manual smoke check**

Run: `bun run --cwd web build`, then run `cd backend && DB_PATH=./data/birdie.db PORT=4000 bun src/cli.ts web`. Open `http://localhost:4000` in a browser, submit a trace via the Capture form, and confirm no console errors. Also run `bun run --cwd web dev` if you want Vite hot reload during iteration; it should proxy API calls to `:4000`. (The Review queue will show nothing until a lesson is extracted via an MCP-connected assistant, which requires registering the MCP server with a host — that's expected at this point.)

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "Add one-page web UI: capture form + review queue"
```

---

### Task 12: Config module (`~/.birdie/config.json`)

**Files:**
- Create: `backend/src/config.ts`
- Test: `backend/test/config.test.ts`

**Interfaces:**
- Produces: `interface BirdieConfig { mode: 'local' | 'remote'; server_url?: string }`; `getBirdieHome(): string`; `getConfigPath(): string`; `readConfig(): BirdieConfig | undefined`; `writeConfig(config: BirdieConfig): void`; `resolveDbPath(): string`. Used by `complete_setup` (Task 13), domain profile resolution (Task 14), and `mcpContext.ts` (Task 15).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBirdieHome, getConfigPath, readConfig, resolveDbPath, writeConfig } from '../src/config.js';

describe('config', () => {
  let dir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-config-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    delete process.env.BIRDIE_CONFIG_PATH;
    delete process.env.DB_PATH;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the config path from BIRDIE_CONFIG_PATH', () => {
    expect(getConfigPath()).toBe(join(dir, 'config.json'));
  });

  it('returns undefined when no config file exists yet (first run)', () => {
    expect(readConfig()).toBeUndefined();
  });

  it('round-trips a local config', () => {
    writeConfig({ mode: 'local' });
    expect(readConfig()).toEqual({ mode: 'local' });
  });

  it('round-trips a remote config with a server_url', () => {
    writeConfig({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
    expect(readConfig()).toEqual({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
  });

  it('treats a corrupt config file as first-run instead of throwing', () => {
    writeConfig({ mode: 'local' });
    writeFileSync(getConfigPath(), '{ not valid json');
    expect(readConfig()).toBeUndefined();
  });

  it('resolves the db path from DB_PATH when set', () => {
    process.env.DB_PATH = join(dir, 'custom.db');
    expect(resolveDbPath()).toBe(join(dir, 'custom.db'));
  });

  it('defaults the db path under the birdie home directory', () => {
    delete process.env.DB_PATH;
    process.env.HOME = dir;
    expect(getBirdieHome()).toBe(join(dir, '.birdie'));
    expect(resolveDbPath()).toBe(join(dir, '.birdie', 'birdie.db'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test config`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Create `backend/src/config.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BirdieConfig {
  mode: 'local' | 'remote';
  server_url?: string;
}

export function getBirdieHome(): string {
  return join(homedir(), '.birdie');
}

export function getConfigPath(): string {
  return process.env.BIRDIE_CONFIG_PATH ?? join(getBirdieHome(), 'config.json');
}

export function readConfig(): BirdieConfig | undefined {
  const path = getConfigPath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed.mode !== 'local' && parsed.mode !== 'remote') return undefined;
    if (parsed.mode === 'remote' && typeof parsed.server_url !== 'string') return undefined;
    return parsed as BirdieConfig;
  } catch {
    return undefined;
  }
}

export function writeConfig(config: BirdieConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(getBirdieHome(), 'birdie.db');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd backend test config`
Expected: PASS (7 tests passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.ts backend/test/config.test.ts
git commit -m "Add config module for first-run detection (~/.birdie/config.json)"
```

---

### Task 13: `complete_setup` MCP tool and local default paths under `~/.birdie`

**Files:**
- Modify: `backend/src/context.ts` (use `resolveDbPath()` instead of an inline default)
- Modify: `backend/src/mcp/tools.ts` (add the `complete_setup` tool)
- Test: Create `backend/test/setup.test.ts`

**Interfaces:**
- Consumes: `resolveDbPath`, `readConfig`, `writeConfig`, `BirdieConfig` (Task 12), `openDb` (Task 2).
- Produces (added to `mcp/tools.ts`): `completeSetupParams`, `async completeSetupHandler(args): Promise<BirdieConfig>`, registered as the `complete_setup` MCP tool. Unlike every other tool in this file, `complete_setup` does not take a `ToolContext` — it operates directly on `config.ts` / `db.ts`, because it's what makes a working `ToolContext` possible in the first place (Task 15).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/setup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.js';
import { completeSetupHandler } from '../src/mcp/tools.js';

describe('completeSetupHandler', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-setup-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    process.env.DB_PATH = join(dir, 'birdie.db');
  });

  afterEach(() => {
    delete process.env.BIRDIE_CONFIG_PATH;
    delete process.env.DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a local config and creates the database file', async () => {
    await completeSetupHandler({ mode: 'local' });
    expect(readConfig()).toEqual({ mode: 'local' });
    expect(existsSync(join(dir, 'birdie.db'))).toBe(true);
  });

  it('writes a remote config with the given server_url', async () => {
    await completeSetupHandler({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
    expect(readConfig()).toEqual({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
    expect(existsSync(join(dir, 'birdie.db'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test setup`
Expected: FAIL — `completeSetupHandler is not a function` (not exported yet).

- [ ] **Step 3: Modify `backend/src/context.ts`**

Add this import near the top:

```typescript
import { resolveDbPath } from './config.js';
```

Replace the `dbPath` line inside `buildContext`:

```typescript
  const dbPath = resolveDbPath();
```

- [ ] **Step 4: Modify `backend/src/mcp/tools.ts`**

Add these imports near the top:

```typescript
import { readConfig, resolveDbPath, writeConfig, type BirdieConfig } from '../config.js';
import { openDb } from '../db.js';
```

Add this after `askJuniorStrugglesHandler`:

```typescript
export const completeSetupParams = z.union([
  z.object({ mode: z.literal('local') }),
  z.object({ mode: z.literal('remote'), server_url: z.string().url() }),
]);

export async function completeSetupHandler(args: z.infer<typeof completeSetupParams>): Promise<BirdieConfig> {
  if (args.mode === 'local') {
    const db = openDb(resolveDbPath()); // creates the file and runs schema migration if it doesn't exist yet
    db.close();
    writeConfig({ mode: 'local' });
  } else {
    writeConfig({ mode: 'remote', server_url: args.server_url });
  }
  return readConfig()!;
}
```

Add this registration inside `registerTools`, after the `ask_junior_struggles` registration:

```typescript
  server.addTool({
    name: 'complete_setup',
    description:
      "Finish Birdie's first-run setup. Pass { mode: 'local' } to store data on this device, or { mode: 'remote', server_url } to use a team's existing Birdie server.",
    parameters: completeSetupParams,
    execute: async (args) => JSON.stringify(await completeSetupHandler(args)),
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd backend test setup`
Expected: PASS (2 tests passed).

- [ ] **Step 6: Run the full backend test suite to verify nothing broke**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 7: Commit**

```bash
git add backend/src/context.ts backend/src/mcp/tools.ts backend/test/setup.test.ts
git commit -m "Add complete_setup MCP tool and move local default paths under ~/.birdie"
```

---

### Task 14: Guided domain-profile setup

**Files:**
- Modify: `backend/src/domain.ts` (add `resolveDomainProfilePath`, `saveDomainProfile`)
- Modify: `backend/src/context.ts` (use `resolveDomainProfilePath()`)
- Modify: `backend/src/mcp/tools.ts` (add the `save_domain_profile` tool)
- Test: Modify `backend/test/domain.test.ts`
- Test: Modify `backend/test/setup.test.ts`

**Interfaces:**
- Produces (added to `domain.ts`): `resolveDomainProfilePath(): string`, `saveDomainProfile(content: string): void`. Used by `context.ts`, `mcp/tools.ts`, and `mcpContext.ts` (Task 15).

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `backend/test/domain.test.ts` (alongside the existing ones):

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
```

and extend the existing `import { loadDomainProfile, parseTypologyCategories } from '../src/domain.js';` line to:

```typescript
import { loadDomainProfile, parseTypologyCategories, resolveDomainProfilePath, saveDomainProfile } from '../src/domain.js';
```

Append this describe block to the end of the file:

```typescript
describe('resolveDomainProfilePath / saveDomainProfile', () => {
  let dir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-domainpath-'));
    originalHome = process.env.HOME;
    process.env.HOME = dir;
    delete process.env.DOMAIN_PROFILE_PATH;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.DOMAIN_PROFILE_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to DOMAIN_PROFILE_PATH when no customized profile exists', () => {
    process.env.DOMAIN_PROFILE_PATH = '/some/domain.md';
    expect(resolveDomainProfilePath()).toBe('/some/domain.md');
  });

  it('falls back to ./domain.md when neither a customized profile nor DOMAIN_PROFILE_PATH exists', () => {
    expect(resolveDomainProfilePath()).toBe('./domain.md');
  });

  it('prefers ~/.birdie/domain.md once one has been saved', () => {
    saveDomainProfile('# Domain\ncustom\n\n# Typology\n- foo: bar\n\n# What counts as mentorship-worthy\nx\n');
    expect(resolveDomainProfilePath()).toBe(join(dir, '.birdie', 'domain.md'));
    expect(loadDomainProfile(resolveDomainProfilePath()).typology_categories).toEqual(['foo']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test domain`
Expected: FAIL — `resolveDomainProfilePath is not a function`.

- [ ] **Step 3: Modify `backend/src/domain.ts`**

Change the top import line from `import { readFileSync } from 'node:fs';` to:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBirdieHome } from './config.js';
```

Add these functions after `loadDomainProfile`:

```typescript
export function resolveDomainProfilePath(): string {
  const customized = join(getBirdieHome(), 'domain.md');
  if (existsSync(customized)) return customized;
  return process.env.DOMAIN_PROFILE_PATH ?? './domain.md';
}

export function saveDomainProfile(content: string): void {
  const home = getBirdieHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'domain.md'), content);
}
```

- [ ] **Step 4: Modify `backend/src/context.ts`**

Change the import from `./domain.js` to include `resolveDomainProfilePath`, and replace the `domainProfilePath` line inside `buildContext`:

```typescript
import { loadDomainProfile, resolveDomainProfilePath, type DomainProfile } from './domain.js';
...
  const domainProfilePath = resolveDomainProfilePath();
```

- [ ] **Step 5: Modify `backend/src/mcp/tools.ts`**

Add this import near the top:

```typescript
import { saveDomainProfile } from '../domain.js';
```

Add this after `completeSetupHandler`:

```typescript
export const saveDomainProfileParams = z.object({ content: z.string().min(1) });

export async function saveDomainProfileHandler(args: z.infer<typeof saveDomainProfileParams>): Promise<{ saved: true }> {
  saveDomainProfile(args.content);
  return { saved: true };
}
```

Add this registration inside `registerTools`, after `complete_setup`:

```typescript
  server.addTool({
    name: 'save_domain_profile',
    description:
      "Write a customized domain profile (typology categories and what's mentorship-worthy) to ~/.birdie/domain.md, produced from the setup interview.",
    parameters: saveDomainProfileParams,
    execute: async (args) => JSON.stringify(await saveDomainProfileHandler(args)),
  });
```

- [ ] **Step 6: Write the failing test for `saveDomainProfileHandler`**

Append to `backend/test/setup.test.ts` (add `mkdtempSync, rmSync` and `join`/`tmpdir` imports if not already present, plus `saveDomainProfileHandler` and `resolveDomainProfilePath`):

```typescript
import { saveDomainProfileHandler } from '../src/mcp/tools.js';
import { resolveDomainProfilePath } from '../src/domain.js';

describe('saveDomainProfileHandler', () => {
  let dir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-domain-setup-'));
    originalHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the profile so resolveDomainProfilePath picks it up', async () => {
    await saveDomainProfileHandler({
      content: '# Domain\naudit\n\n# Typology\n- materiality: x\n\n# What counts as mentorship-worthy\ny\n',
    });
    expect(resolveDomainProfilePath()).toBe(join(dir, '.birdie', 'domain.md'));
  });
});
```

- [ ] **Step 7: Run the full backend test suite**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 8: Commit**

```bash
git add backend/src/domain.ts backend/src/context.ts backend/src/mcp/tools.ts backend/test/domain.test.ts backend/test/setup.test.ts
git commit -m "Add guided domain-profile setup: save_domain_profile tool and ~/.birdie/domain.md resolution"
```

---

### Task 15: Remote-sync REST routes, remote services, and the MCP-only context builder

**Files:**
- Modify: `backend/src/routes/traces.ts` (add `POST /:id/skip`, `POST /:id/extract`)
- Modify: `backend/src/routes/lessons.ts` (add `GET /ask/senior-approach`, `GET /ask/junior-struggles`)
- Create: `backend/src/services/remoteRequest.ts`
- Create: `backend/src/services/remoteTraceService.ts`
- Create: `backend/src/services/remoteLessonService.ts`
- Create: `backend/src/mcpContext.ts`
- Modify: `backend/src/mcp/tools.ts` (`registerTools` takes `getCtx: () => ToolContext` instead of a pre-built context)
- Modify: `backend/src/mcp/server.ts` (`createMcpServer` takes `getCtx`)
- Modify: `backend/src/cli.ts` (`mcp` mode uses `buildMcpContext`)
- Test: Modify `backend/test/routes.test.ts`
- Test: Create `backend/test/remoteService.test.ts`
- Test: Create `backend/test/mcpContext.test.ts`

**Interfaces:**
- Consumes: `TraceServiceLike`, `LessonServiceLike` (Task 1), `readConfig` (Task 12), `buildContext`, `toToolContext` (Task 6).
- Produces: `remoteRequest<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T>`; `class RemoteTraceService` / `class RemoteLessonService` (both `constructor(serverUrl: string)`), each satisfying `TraceServiceLike` / `LessonServiceLike`; `class BirdieNotConfiguredError extends Error`; `buildMcpContext(): ToolContext`. This is the code behind design spec §4.3 — local vs. shared server is decided once per tool call, not baked in at process startup, so the same running MCP server can go from "not configured" to "configured" mid-session as soon as `complete_setup` runs.

- [ ] **Step 1: Write the failing REST route tests**

Append to `backend/test/routes.test.ts`:

```typescript
  it('skips a trace via POST /traces/:id/skip', async () => {
    const trace = ctx.traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'teh',
      after_text: 'the',
    });
    const res = await request(app).post(`/traces/${trace.id}/skip`).send({ reason: 'Typo fix only.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
  });

  it('extracts a lesson via POST /traces/:id/extract', async () => {
    const trace = ctx.traceService.capture({
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const res = await request(app).post(`/traces/${trace.id}/extract`).send({
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(res.status).toBe(200);
    expect(res.body.quote_verified).toBe(true);
  });

  it('answers ask/senior-approach and ask/junior-struggles', async () => {
    const trace = ctx.traceService.capture({
      submitted_by: 'Sarah',
      submitted_by_role: 'senior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = ctx.traceService.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    ctx.lessonService.promote(lesson.id, { reviewer: 'Sarah' });

    const approach = await request(app).get('/lessons/ask/senior-approach?question=indemnity&senior_name=Sarah');
    expect(approach.status).toBe(200);
    expect(approach.body).toHaveLength(1);

    const struggles = await request(app).get('/lessons/ask/junior-struggles?junior_name=Jane');
    expect(struggles.status).toBe(200);
    expect(struggles.body.typology_counts).toEqual({ substantive_risk: 1 });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test routes`
Expected: FAIL — `404` responses (routes don't exist yet).

- [ ] **Step 3: Modify `backend/src/routes/traces.ts`**

Add this after the `traceStatusQuery` definition:

```typescript
const skipTraceBody = z.object({ reason: z.string().min(1) });
const extractTraceBody = z.object({
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
  typology: z.string().min(1),
  playbook_alignment: z.enum(['aligned', 'diverges', 'not_applicable']).optional(),
  playbook_note: z.string().optional(),
});
```

Add these routes inside `tracesRouter`, before `return router;`:

```typescript
  router.post('/:id/skip', (req, res) => {
    const parsed = skipTraceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      res.json(ctx.traceService.skip(req.params.id, parsed.data.reason));
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  router.post('/:id/extract', (req, res) => {
    const parsed = extractTraceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      res.json(ctx.traceService.extract({ trace_id: req.params.id, ...parsed.data }));
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });
```

- [ ] **Step 4: Modify `backend/src/routes/lessons.ts`**

Add these routes inside `lessonsRouter`, immediately after `router.get('/', ...)` and **before** `router.get('/:id', ...)` — Express matches routes in registration order, and `/:id` would otherwise swallow `/ask/senior-approach` as `id="ask"`:

```typescript
  router.get('/ask/senior-approach', (req, res) => {
    const { question, senior_name } = req.query;
    if (typeof question !== 'string' || question.length === 0) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    res.json(ctx.lessonService.askSeniorApproach(question, senior_name as string | undefined));
  });

  router.get('/ask/junior-struggles', (req, res) => {
    const { junior_name } = req.query;
    res.json(ctx.lessonService.askJuniorStruggles(junior_name as string | undefined));
  });
```

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `bun run --cwd backend test routes`
Expected: PASS (8 tests passed).

- [ ] **Step 6: Write the failing remote-service tests**

Create `backend/test/remoteService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { RemoteTraceService } from '../src/services/remoteTraceService.js';
import { RemoteLessonService } from '../src/services/remoteLessonService.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('RemoteTraceService / RemoteLessonService', () => {
  const serverUrl = 'http://birdie.internal:4000';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('capture posts to /traces and returns the parsed trace', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't1', status: 'captured' }));
    const service = new RemoteTraceService(serverUrl);
    const trace = await service.capture({
      before_text: 'a',
      after_text: 'b',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    expect(trace).toEqual({ id: 't1', status: 'captured' });
    expect(fetchMock).toHaveBeenCalledWith(`${serverUrl}/traces`, expect.objectContaining({ method: 'POST' }));
  });

  it('extract posts to /traces/:id/extract', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'l1', quote_verified: true }));
    const service = new RemoteTraceService(serverUrl);
    const lesson = await service.extract({
      trace_id: 't1',
      quote: 'a',
      what_changed: 'x',
      why_it_matters: 'y',
      typology: 'other',
    });
    expect(lesson).toEqual({ id: 'l1', quote_verified: true });
    expect(fetchMock).toHaveBeenCalledWith(`${serverUrl}/traces/t1/extract`, expect.objectContaining({ method: 'POST' }));
  });

  it('surfaces an unreachable server as a clear error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const service = new RemoteTraceService(serverUrl);
    await expect(service.list()).rejects.toThrow(/Can't reach the Birdie server/);
  });

  it('askSeniorApproach calls the ask/senior-approach endpoint with query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'l1' }]));
    const service = new RemoteLessonService(serverUrl);
    const results = await service.askSeniorApproach('indemnity', 'Sarah');
    expect(results).toEqual([{ id: 'l1' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${serverUrl}/lessons/ask/senior-approach?question=indemnity&senior_name=Sarah`,
      undefined
    );
  });

  it('get returns undefined when the remote lesson is not found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Lesson not found' }, false, 404));
    const service = new RemoteLessonService(serverUrl);
    expect(await service.get('nope')).toBeUndefined();
  });

  it('surfaces a non-ok response body error message for other failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Internal server error' }, false, 500));
    const service = new RemoteLessonService(serverUrl);
    await expect(service.get('boom')).rejects.toThrow('Internal server error');
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `bun run --cwd backend test remoteService`
Expected: FAIL — `Cannot find module '../src/services/remoteTraceService.js'`.

- [ ] **Step 8: Create `backend/src/services/remoteRequest.ts`**

```typescript
export async function remoteRequest<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, init);
  } catch {
    throw new Error(`Can't reach the Birdie server at ${serverUrl} - check the URL or ask whoever set it up.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Birdie server request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 9: Create `backend/src/services/remoteTraceService.ts`**

```typescript
import { remoteRequest } from './remoteRequest.js';
import type { LessonWithTrace, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

export class RemoteTraceService {
  constructor(private serverUrl: string) {}

  capture(input: NewTrace): Promise<Trace> {
    return remoteRequest(this.serverUrl, '/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  get(id: string): Promise<Trace | undefined> {
    return remoteRequest<Trace>(this.serverUrl, `/traces/${id}`).catch((err) => {
      if ((err as Error).message.includes('not found')) return undefined;
      throw err;
    });
  }

  list(status?: TraceStatus): Promise<Trace[]> {
    const query = status ? `?status=${status}` : '';
    return remoteRequest(this.serverUrl, `/traces${query}`);
  }

  skip(id: string, reason: string): Promise<Trace> {
    return remoteRequest(this.serverUrl, `/traces/${id}/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  }

  extract(input: NewExtraction): Promise<LessonWithTrace> {
    const { trace_id, ...body } = input;
    return remoteRequest(this.serverUrl, `/traces/${trace_id}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
```

- [ ] **Step 10: Create `backend/src/services/remoteLessonService.ts`**

```typescript
import { remoteRequest } from './remoteRequest.js';
import type { LessonEdit, LessonFilters, LessonWithTrace, PromotePayload } from '../types.js';

export class RemoteLessonService {
  constructor(private serverUrl: string) {}

  list(filters: LessonFilters): Promise<LessonWithTrace[]> {
    const entries = Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][];
    const query = entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
    return remoteRequest(this.serverUrl, `/lessons${query}`);
  }

  get(id: string): Promise<LessonWithTrace | undefined> {
    return remoteRequest<LessonWithTrace>(this.serverUrl, `/lessons/${id}`).catch((err) => {
      if ((err as Error).message.includes('not found')) return undefined;
      throw err;
    });
  }

  review(id: string, changes: LessonEdit): Promise<LessonWithTrace> {
    return remoteRequest(this.serverUrl, `/lessons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
  }

  promote(id: string, payload: PromotePayload): Promise<LessonWithTrace> {
    return remoteRequest(this.serverUrl, `/lessons/${id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  askSeniorApproach(question: string, senior_name?: string): Promise<LessonWithTrace[]> {
    const params = new URLSearchParams({ question, ...(senior_name ? { senior_name } : {}) });
    return remoteRequest(this.serverUrl, `/lessons/ask/senior-approach?${params.toString()}`);
  }

  askJuniorStruggles(junior_name?: string): Promise<{ lessons: LessonWithTrace[]; typology_counts: Record<string, number> }> {
    const params = new URLSearchParams(junior_name ? { junior_name } : {});
    const query = params.toString() ? `?${params.toString()}` : '';
    return remoteRequest(this.serverUrl, `/lessons/ask/junior-struggles${query}`);
  }
}
```

- [ ] **Step 11: Run the remote-service tests to verify they pass**

Run: `bun run --cwd backend test remoteService`
Expected: PASS (6 tests passed).

- [ ] **Step 12: Modify `backend/src/mcp/tools.ts` so `registerTools` takes a context getter, not a fixed context**

Replace the `registerTools` signature and every `execute` callback's use of `ctx` with `getCtx()`:

```typescript
export function registerTools(server: FastMCP, getCtx: () => ToolContext): void {
  server.addTool({
    name: 'capture_trace',
    description: 'Capture a before/after edit as a trace for later extraction into a mentorship lesson.',
    parameters: captureTraceParams,
    execute: async (args) => JSON.stringify(await captureTraceHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'get_trace',
    description: "Read a trace's before/after/playbook text to reason over before extracting a lesson.",
    parameters: getTraceParams,
    execute: async (args) => JSON.stringify(await getTraceHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'skip_extraction',
    description: 'Mark a trace as not mentorship-worthy instead of forcing a lesson out of it.',
    parameters: skipExtractionParams,
    execute: async (args) => JSON.stringify(await skipExtractionHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'save_extraction',
    description: 'Persist an extracted lesson: quote, what changed, why it matters, typology, and playbook alignment.',
    parameters: saveExtractionParams,
    execute: async (args) => JSON.stringify(await saveExtractionHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'list_lessons',
    description: 'List lessons, filterable by status, typology, playbook_ref, junior_name, senior_name.',
    parameters: listLessonsParams,
    execute: async (args) => JSON.stringify(await listLessonsHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'review_lesson',
    description: 'Edit a pending lesson in place, or reject it.',
    parameters: reviewLessonParams,
    execute: async (args) => JSON.stringify(await reviewLessonHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'promote_lesson',
    description: 'Promote a reviewed lesson into the shared pool, requiring a reviewer name.',
    parameters: promoteLessonParams,
    execute: async (args) => JSON.stringify(await promoteLessonHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'ask_senior_approach',
    description: 'Find promoted lessons matching a question, optionally filtered to one senior.',
    parameters: askSeniorApproachParams,
    execute: async (args) => JSON.stringify(await askSeniorApproachHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'ask_junior_struggles',
    description: 'Summarize promoted lessons for a junior (or all juniors) with a typology breakdown.',
    parameters: askJuniorStrugglesParams,
    execute: async (args) => JSON.stringify(await askJuniorStrugglesHandler(getCtx(), args)),
  });
  server.addTool({
    name: 'complete_setup',
    description:
      "Finish Birdie's first-run setup. Pass { mode: 'local' } to store data on this device, or { mode: 'remote', server_url } to use a team's existing Birdie server.",
    parameters: completeSetupParams,
    execute: async (args) => JSON.stringify(await completeSetupHandler(args)),
  });
  server.addTool({
    name: 'save_domain_profile',
    description:
      "Write a customized domain profile (typology categories and what's mentorship-worthy) to ~/.birdie/domain.md, produced from the setup interview.",
    parameters: saveDomainProfileParams,
    execute: async (args) => JSON.stringify(await saveDomainProfileHandler(args)),
  });
}
```

Note what changed and what didn't: every exported `...Handler` function (`captureTraceHandler`, `askSeniorApproachHandler`, etc.) still takes a concrete `ctx: ToolContext` exactly as before — Tasks 6/7's tests, which call these handlers directly, are unaffected. Only `registerTools` itself now asks for a context *getter* and calls it fresh inside each tool's `execute`, so a context built after startup (once `complete_setup` has run) is picked up on the very next tool call, and `complete_setup` / `save_domain_profile` — which don't call `getCtx()` at all — work even before that.

- [ ] **Step 13: Modify `backend/src/mcp/server.ts`**

```typescript
import { FastMCP } from 'fastmcp';
import { registerTools, type ToolContext } from './tools.js';
import { registerPrompts } from './prompts.js';
import type { DomainProfile } from '../domain.js';

export function createMcpServer(getCtx: () => ToolContext, domainProfile: DomainProfile): FastMCP {
  const server = new FastMCP({ name: 'birdie', version: '0.1.0' });
  registerTools(server, getCtx);
  registerPrompts(server, domainProfile);
  return server;
}
```

- [ ] **Step 14: Write the failing test for `mcpContext.ts`**

Create `backend/test/mcpContext.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeConfig } from '../src/config.js';
import { buildMcpContext, BirdieNotConfiguredError } from '../src/mcpContext.js';

describe('buildMcpContext', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-mcpctx-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    process.env.DB_PATH = join(dir, 'birdie.db');
    process.env.DOMAIN_PROFILE_PATH = '/nonexistent/domain.md';
  });

  afterEach(() => {
    delete process.env.BIRDIE_CONFIG_PATH;
    delete process.env.DB_PATH;
    delete process.env.DOMAIN_PROFILE_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws BirdieNotConfiguredError when no config exists yet', () => {
    expect(() => buildMcpContext()).toThrow(BirdieNotConfiguredError);
  });

  it('builds a local ToolContext backed by SQLite when mode is local', async () => {
    writeConfig({ mode: 'local' });
    const ctx = buildMcpContext();
    const trace = await ctx.traceService.capture({
      before_text: 'a',
      after_text: 'b',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    expect(trace.status).toBe('captured');
  });

  it('builds a remote ToolContext backed by RemoteTraceService/RemoteLessonService when mode is remote', () => {
    writeConfig({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
    const ctx = buildMcpContext();
    expect(ctx.traceService.constructor.name).toBe('RemoteTraceService');
    expect(ctx.lessonService.constructor.name).toBe('RemoteLessonService');
  });
});
```

- [ ] **Step 15: Run the tests to verify they fail**

Run: `bun run --cwd backend test mcpContext`
Expected: FAIL — `Cannot find module '../src/mcpContext.js'`.

- [ ] **Step 16: Create `backend/src/mcpContext.ts`**

```typescript
import { buildContext, toToolContext } from './context.js';
import { readConfig } from './config.js';
import { RemoteTraceService } from './services/remoteTraceService.js';
import { RemoteLessonService } from './services/remoteLessonService.js';
import type { ToolContext } from './mcp/tools.js';

export class BirdieNotConfiguredError extends Error {
  constructor() {
    super("Birdie isn't set up yet. Run Birdie's setup-birdie prompt (or call complete_setup) first.");
    this.name = 'BirdieNotConfiguredError';
  }
}

// The MCP-only context builder (design spec §4.3): unlike buildContext() (REST/web, always
// local), this reads ~/.birdie/config.json and picks a local or remote ToolContext
// accordingly. complete_setup and save_domain_profile (Task 13/14) don't depend on this -
// they work whether or not Birdie is configured yet, since that's how setup gets done.
export function buildMcpContext(): ToolContext {
  const config = readConfig();
  if (!config) throw new BirdieNotConfiguredError();
  if (config.mode === 'remote') {
    return {
      traceService: new RemoteTraceService(config.server_url!),
      lessonService: new RemoteLessonService(config.server_url!),
    };
  }
  return toToolContext(buildContext());
}
```

- [ ] **Step 17: Run the tests to verify they pass**

Run: `bun run --cwd backend test mcpContext`
Expected: PASS (3 tests passed).

- [ ] **Step 18: Modify `backend/src/cli.ts`**

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { buildContext } from './context.js';
import { createServer } from './server.js';
import { createMcpServer } from './mcp/server.js';
import { buildMcpContext } from './mcpContext.js';
import { loadDomainProfile, resolveDomainProfilePath } from './domain.js';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'both';

  if (mode === 'web' || mode === 'both') {
    const ctx = buildContext();
    const port = Number(process.env.PORT ?? 4000);
    createServer(ctx).listen(port, () => {
      console.error(`Birdie REST API + web UI listening on http://localhost:${port}`);
    });
  }

  if (mode === 'mcp' || mode === 'both') {
    const domainProfile = loadDomainProfile(resolveDomainProfilePath());
    const server = createMcpServer(buildMcpContext, domainProfile);
    await server.start({ transportType: 'stdio' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`buildMcpContext` is passed by reference as the `getCtx` callback — its signature (`(): ToolContext`) already matches, and passing the function itself means every tool call re-reads `~/.birdie/config.json` fresh, exactly as `registerTools` (Step 12) expects.

- [ ] **Step 19: Run the full backend test suite**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 20: Commit**

```bash
git add backend/src/routes/traces.ts backend/src/routes/lessons.ts backend/src/services/remoteRequest.ts backend/src/services/remoteTraceService.ts backend/src/services/remoteLessonService.ts backend/src/mcpContext.ts backend/src/mcp/tools.ts backend/src/mcp/server.ts backend/src/cli.ts backend/test/routes.test.ts backend/test/remoteService.test.ts backend/test/mcpContext.test.ts
git commit -m "Add remote-sync REST routes, RemoteTraceService/RemoteLessonService, and mcpContext for local-vs-remote MCP selection"
```

---

### Task 16: `open_review_queue` MCP tool

**Files:**
- Modify: `backend/src/mcp/tools.ts` (add `open_review_queue`)
- Test: Create `backend/test/openReviewQueue.test.ts`

**Interfaces:**
- Produces (added to `mcp/tools.ts`): `async openReviewQueueHandler(): Promise<{ url: string }>`, registered as the `open_review_queue` MCP tool.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/openReviewQueue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeConfig } from '../src/config.js';
import { openReviewQueueHandler } from '../src/mcp/tools.js';

describe('openReviewQueueHandler', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdie-openqueue-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
  });

  afterEach(() => {
    delete process.env.BIRDIE_CONFIG_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when Birdie is not set up yet', async () => {
    await expect(openReviewQueueHandler()).rejects.toThrow(/not set up/);
  });

  it('returns the shared server URL directly in remote mode, without starting a local server', async () => {
    writeConfig({ mode: 'remote', server_url: 'http://birdie.internal:4000' });
    const result = await openReviewQueueHandler();
    expect(result).toEqual({ url: 'http://birdie.internal:4000' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test openReviewQueue`
Expected: FAIL — `openReviewQueueHandler is not a function`.

- [ ] **Step 3: Modify `backend/src/mcp/tools.ts`**

Add these imports near the top:

```typescript
import { buildContext } from '../context.js';
import { createServer } from '../server.js';
```

Add this after `saveDomainProfileHandler`:

```typescript
let localWebServerUrl: string | undefined;
let localWebServer: import('node:http').Server | undefined;

export async function openReviewQueueHandler(): Promise<{ url: string }> {
  const config = readConfig();
  if (!config) throw new Error("Birdie isn't set up yet. Call complete_setup first.");
  if (config.mode === 'remote') {
    return { url: config.server_url! };
  }
  if (!localWebServerUrl) {
    const requestedPort = Number(process.env.PORT ?? 0);
    const ctx = buildContext();
    await new Promise<void>((resolve) => {
      localWebServer = createServer(ctx).listen(requestedPort, '127.0.0.1', resolve);
    });
    const address = localWebServer!.address();
    const port = typeof address === 'object' && address ? address.port : requestedPort;
    localWebServerUrl = `http://127.0.0.1:${port}`;
  }
  return { url: localWebServerUrl };
}
```

Add this registration inside `registerTools`, after `save_domain_profile`:

```typescript
  server.addTool({
    name: 'open_review_queue',
    description: 'Start (if needed) and return the URL of the review queue web page.',
    parameters: z.object({}),
    execute: async () => JSON.stringify(await openReviewQueueHandler()),
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd backend test openReviewQueue`
Expected: PASS (2 tests passed). The local-mode branch (actually starting the web server) is intentionally not covered here — it's verified manually in Step 5, the same way Task 10/11 verify real server startup by running the CLI directly rather than through vitest.

- [ ] **Step 5: Manual smoke check for local mode**

Run: `cd backend && BIRDIE_CONFIG_PATH=/tmp/birdie-smoke-config.json DB_PATH=/tmp/birdie-smoke.db bun src/cli.ts mcp`, then from an MCP-capable client (or a short throwaway script calling the server's stdio transport) call `complete_setup` with `{ "mode": "local" }` followed by `open_review_queue`. Expected: the tool returns a `http://127.0.0.1:<port>` URL and that URL serves the review queue page in a browser (empty, since nothing's been captured yet — that's expected).

- [ ] **Step 6: Commit**

```bash
git add backend/src/mcp/tools.ts backend/test/openReviewQueue.test.ts
git commit -m "Add open_review_queue MCP tool"
```

---

### Task 17: Plain-language copy layer

**Files:**
- Create: `backend/src/copy.ts`
- Create: `web/src/copy.ts` (kept identical to `backend/src/copy.ts` by hand — `backend` and `web` are separate Bun workspaces with no shared package between them yet, so this is intentionally duplicated rather than cross-imported; a future pass could extract a small `@birdie/copy` workspace package if the duplication becomes a real maintenance problem)
- Modify: `backend/src/mcp/tools.ts` (use `copy.trace` in the `capture_trace` description)
- Modify: `web/src/ReviewList.tsx` (use plain-language labels instead of raw field names)
- Test: Create `backend/test/copy.test.ts`

**Interfaces:**
- Produces: `export const copy = { trace, typology, quoteNotVerified, playbookDiverges, playbookAligns, promoteAction, statusPendingReview, domainProfileLabel }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/copy.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { copy } from '../src/copy.js';

describe('copy', () => {
  it('phrases quote verification failure in plain language, not the raw field name', () => {
    expect(copy.quoteNotVerified.toLowerCase()).not.toContain('quote_verified');
    expect(copy.quoteNotVerified).toContain("couldn't find");
  });

  it('phrases a playbook divergence in plain language', () => {
    expect(copy.playbookDiverges).toBe('This edit differs from your playbook.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test copy`
Expected: FAIL — `Cannot find module '../src/copy.js'`.

- [ ] **Step 3: Create `backend/src/copy.ts`**

```typescript
export const copy = {
  trace: 'example',
  typology: 'category',
  quoteNotVerified: "We couldn't find this exact wording in the original text — please check it.",
  playbookDiverges: 'This edit differs from your playbook.',
  playbookAligns: 'Follows your playbook.',
  promoteAction: 'Add to shared library',
  statusPendingReview: 'Waiting for review',
  domainProfileLabel: "your team's settings",
} as const;
```

- [ ] **Step 4: Copy the same content to `web/src/copy.ts`**

Create `web/src/copy.ts` with identical content to `backend/src/copy.ts` above.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --cwd backend test copy`
Expected: PASS (2 tests passed).

- [ ] **Step 6: Modify `backend/src/mcp/tools.ts`**

Add this import near the top:

```typescript
import { copy } from '../copy.js';
```

Change the `capture_trace` tool's description:

```typescript
    description: `Capture a before/after edit as an ${copy.trace} for later extraction into a mentorship lesson.`,
```

- [ ] **Step 7: Modify `web/src/ReviewList.tsx`**

Add this import near the top:

```typescript
import { copy } from './copy.js';
```

Replace the quote-verification and playbook-divergence banners:

```typescript
          {!lesson.quote_verified && <p style={{ color: 'darkred' }}>{copy.quoteNotVerified}</p>}
          {lesson.playbook_alignment === 'diverges' && (
            <p style={{ color: 'darkorange' }}>
              {copy.playbookDiverges} {lesson.playbook_note}
            </p>
          )}
```

Replace the promote button's label:

```typescript
          <button onClick={() => handlePromote(lesson)}>{copy.promoteAction}</button>
```

- [ ] **Step 8: Run the full backend test suite and rebuild the web workspace**

Run: `bun run --cwd backend test && bun run --cwd web build`
Expected: PASS / build succeeds with no type errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/copy.ts web/src/copy.ts backend/src/mcp/tools.ts web/src/ReviewList.tsx backend/test/copy.test.ts
git commit -m "Add plain-language copy layer for tool descriptions and the web UI"
```

---

### Task 18: `setup-birdie` MCP prompt

**Files:**
- Modify: `backend/src/mcp/prompts.ts` (add `buildSetupBirdiePrompt`, register the `setup-birdie` prompt)
- Test: Modify `backend/test/prompts.test.ts`

**Interfaces:**
- Produces (added to `prompts.ts`): `buildSetupBirdiePrompt(): string`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/prompts.test.ts`:

```typescript
import { buildSetupBirdiePrompt } from '../src/mcp/prompts.js';

it('setup-birdie prompt walks through the local/remote choice and the optional domain interview', () => {
  const prompt = buildSetupBirdiePrompt();
  expect(prompt).toContain('complete_setup');
  expect(prompt).toContain('save_domain_profile');
  expect(prompt).toContain('mode: "remote"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd backend test prompts`
Expected: FAIL — `buildSetupBirdiePrompt is not a function`.

- [ ] **Step 3: Modify `backend/src/mcp/prompts.ts`**

Add this function (position doesn't matter relative to the other builders, but keep it above `registerPrompts`):

```typescript
export function buildSetupBirdiePrompt(): string {
  return `You are running Birdie's first-time setup for this user - do this before attempting any other Birdie action in a new conversation.

1. Ask: "Do you already have a Birdie server URL from your team? If so, share it - otherwise I'll set one up on this device."
2. If they give a URL, call complete_setup with { mode: "remote", server_url: "<their URL>" }.
   If they don't have one (or want to skip), call complete_setup with { mode: "local" }.
3. Then offer, but don't force: "Want to tell me a bit about your field so I can tailor the categories Birdie looks for? Or I can just use the default legal example for now." If they engage, ask what field they're in and what kinds of edits matter most to catch vs. what's just noise, write the answer as:

# Domain
<one paragraph>

# Typology
- category_name: one-line definition
...

# What counts as mentorship-worthy
<guidance>

and call save_domain_profile with that content. If they'd rather skip it, don't call save_domain_profile - the shipped legal default stays active.
4. Once setup is complete, continue with whatever the user originally asked for.`;
}
```

Add this registration inside `registerPrompts`, alongside the other `server.addPrompt` calls:

```typescript
  server.addPrompt({
    name: 'setup-birdie',
    description: "Run Birdie's first-time setup conversation: connect to a server (local or remote) and optionally customize the domain profile.",
    arguments: [],
    load: async () => buildSetupBirdiePrompt(),
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd backend test prompts`
Expected: PASS (4 tests passed).

- [ ] **Step 5: Run the full backend test suite**

Run: `bun run --cwd backend test`
Expected: PASS (all tests across all files still pass).

- [ ] **Step 6: Commit**

```bash
git add backend/src/mcp/prompts.ts backend/test/prompts.test.ts
git commit -m "Add setup-birdie MCP prompt for the first-run conversation"
```

---

### Task 19: Claude Code plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

**Interfaces:**
- None — this is a static manifest, not code other tasks import from.

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "birdie",
  "version": "0.1.0",
  "description": "Capture mentorship moments (a senior's redline of a junior's draft), extract a reviewed lesson from them, and let juniors ask how a senior handled something or seniors ask what a junior is struggling with.",
  "mcpServers": {
    "birdie": {
      "command": "bun",
      "args": ["backend/src/cli.ts", "mcp"]
    }
  },
  "skills": ["skills/birdie-mentor"]
}
```

This manifest is intentionally concrete, not a placeholder: it uses Bun to execute the TypeScript MCP entrypoint directly and relies on Claude Code resolving the command relative to the plugin root. The primary plugin path therefore does not ask the user to run `bun install`, edit MCP JSON, or install a separate TypeScript runner.

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "Add Claude Code plugin manifest bundling the MCP server and Skill"
```

---

### Task 20: Claude Code Skill wrapper (bundled, first-run trigger)

**Files:**
- Create: `skills/birdie-mentor/SKILL.md`

**Interfaces:**
- Consumes: `setup-birdie`, `extract-lesson`, `ask-senior-approach`, `ask-junior-struggles` prompts (Task 8, Task 18); all MCP tools from Tasks 6/7/13/14/16.

- [ ] **Step 1: Create `skills/birdie-mentor/SKILL.md`**

```markdown
---
name: birdie-mentor
description: Capture a before/after edit as a mentorship example, extract a lesson from it, review, promote, or ask what a senior/junior has done - use when the user wants to log a redline/edit for mentorship, review pending lessons, or ask about past senior approaches or junior struggles captured in Birdie.
---

# Birdie Mentor

Birdie captures mentorship moments: a senior's edit to a junior's draft, turned into a reviewed, reusable lesson. This Skill ships bundled with the Birdie plugin (`.claude-plugin/plugin.json`, Task 19) - installing the plugin is the only setup step; you don't need to separately register an MCP server.

The people you're helping are not developers. Talk about "examples" and "lessons" and "categories," not "traces" and "typology" - see `backend/src/copy.ts` (Task 17) for the exact phrasing to reuse.

## First run: check whether Birdie is set up

Before doing anything else in a new conversation, try the action the user asked for. If any tool call fails with a message like "Birdie isn't set up yet," run the `setup-birdie` MCP prompt - it walks through connecting to a local or team server, and optionally interviews the user about their field to customize the categories Birdie looks for. Once setup succeeds, retry the original request.

## Capturing and extracting a lesson

1. If the user describes a before/after edit that hasn't been captured yet, call `capture_trace` with the before/after text, who submitted it, their role, and (if known) the junior/senior names involved.
2. To turn a captured example into a lesson, use the `extract-lesson` MCP prompt (or manually: call `get_trace`, decide if it's mentorship-worthy per the loaded domain profile, then call `save_extraction` or `skip_extraction`).

## Reviewing and promoting

Call `list_lessons` with `status=pending_review` to see what's waiting. Use `review_lesson` to edit or reject, and `promote_lesson` (with a reviewer name) to add a lesson to the shared library. Promotion always requires a human reviewer - never promote a lesson the user hasn't actually looked at. If the user would rather click through a queue than review in chat, call `open_review_queue` and share the URL it returns.

## Asking the two audiences

- A junior asking how a senior handled something: use the `ask-senior-approach` MCP prompt (or call `ask_senior_approach` directly).
- A senior asking what a junior is struggling with: use the `ask-junior-struggles` MCP prompt (or call `ask_junior_struggles` directly).

Both only search the shared library (promoted lessons) - if nothing comes back, say so; don't invent an answer.

## Adapting to a different field

Birdie's categories and "what's mentorship-worthy" criteria come from the domain profile, set up through the `setup-birdie` interview (Task 18) rather than a file you or the user hand-edit. If the user wants to change it later, just ask them what should be different and call `save_domain_profile` with the updated content - there's no code change involved.
```

- [ ] **Step 2: Commit**

```bash
git add skills/birdie-mentor/SKILL.md
git commit -m "Update Birdie Skill for bundled plugin distribution and first-run setup"
```

---

### Task 21: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Birdie

Capture a before/after edit (a senior's redline of a junior's draft), let your connected AI assistant extract a candidate lesson from it, review it, and add it to a shared library two audiences can query: juniors asking how a senior handled something, and seniors asking what a junior is struggling with.

Birdie is an MCP server with no LLM of its own - the model reasoning over what you capture is whichever one is running your connected AI assistant. See `docs/superpowers/specs/2026-07-08-birdie-mentorship-plugin-design.md` for the full design.

## Install (Claude Code)

This is the intended way to run Birdie - no terminal commands beyond the install itself:

1. In Claude Code, run `/plugin install birdie` (or install it from wherever this plugin is listed in your marketplace).
2. Start a conversation and ask Birdie to do something - e.g. "capture this edit for mentorship." The first time, it'll ask whether you already have a team Birdie server URL or want to set one up on this device, and optionally interview you about your field to customize the categories it looks for. Answer in plain language; there's nothing to configure by hand.
3. That's it. Capture, review, and ask all happen by chatting - see `skills/birdie-mentor/SKILL.md` for the full workflow. If you'd rather click through a queue than review in chat, ask your assistant to "open the review queue."

## Advanced: manual MCP registration (Claude Desktop, Codex CLI, local development)

If you're not on Claude Code, or you're developing Birdie itself, you can run and register the server by hand:

\`\`\`bash
bun install
bun run --cwd backend dev mcp   # MCP server only (stdio)
bun run --cwd backend dev web   # REST API + web UI on http://localhost:4000
bun run --cwd backend dev       # both
bun run --cwd web dev           # Vite dev server for the web UI (proxies API calls to :4000)
\`\`\`

Point your MCP host's config at the `mcp` mode:

\`\`\`json
{
  "mcpServers": {
    "birdie": {
      "command": "bun",
      "args": ["backend/src/cli.ts", "mcp"],
      "cwd": "/path/to/birdie"
    }
  }
}
\`\`\`

The same first-run setup conversation (local vs. a team server, and the optional domain-profile interview) applies regardless of how the server was registered - it's driven by the `setup-birdie` MCP prompt and the `complete_setup` / `save_domain_profile` tools, not by anything in this config.

Local storage and the customized domain profile live under `~/.birdie/` (`config.json`, `birdie.db`, and `domain.md` if you've customized it) rather than anywhere in this repo. `backend/.env.example` documents advanced/dev-only overrides (`DB_PATH`, `DOMAIN_PROFILE_PATH`, `BIRDIE_CONFIG_PATH`, `PORT`) for local development - normal use never needs them.

## Testing

\`\`\`bash
bun run --cwd backend test
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add project README with plugin install as the primary path"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered section of the design spec (§1–§13) maps to a task: data model → Task 1/2, quote verification → Task 3, domain profile loading → Task 4, core services → Task 5, MCP tools → Task 6/7, MCP prompts → Task 8, REST → Task 9, run modes/CLI → Task 10, one-page web UI → Task 11, first-run config → Task 12/13, guided domain-profile setup → Task 14, remote-server support → Task 15, on-demand web UI → Task 16, plain-language copy → Task 17, setup-birdie prompt → Task 18, plugin manifest → Task 19, Skill wrapper → Task 20, README → Task 21.
- **Naming consistency:** all wire-facing fields (types.ts, repositories, services' public method signatures for domain data, zod schemas, REST bodies, web `api.ts`) use snake_case matching the spec's §5/§8 field names exactly; only class names, method names, and non-domain local variables use camelCase. Verified `Lesson`/`Trace`/`NewExtraction`/`LessonEdit`/`PromotePayload`/`LessonFilters` field names are identical across Task 1 (definition), Task 2 (repositories), Task 5 (services), Task 6/7 (MCP tools), and Task 9 (REST routes). `TraceServiceLike`/`LessonServiceLike` (Task 1) method names match `TraceService`/`LessonService` (Task 5) exactly, and `RemoteTraceService`/`RemoteLessonService` (Task 15) match both.
- **Async boundary:** `TraceService`/`LessonService` (Task 5) and the SQLite repositories underneath stay synchronous throughout - only the MCP tool layer (`ToolContext`, Task 6 onward) is async, via `toToolContext`'s adapter (Task 6) for the local case and `RemoteTraceService`/`RemoteLessonService`'s real HTTP calls (Task 15) for the remote case. The REST API and web UI (Task 9/11) never touch `ToolContext` and stay fully synchronous underneath, per design spec §4.3.
- **No placeholders:** every step has complete, runnable code — no TODOs or "add validation here" stubs, except Task 19 Step 2, which is a documented external-verification step (the Claude Code plugin manifest schema is versioned outside this repo) rather than a code placeholder.
