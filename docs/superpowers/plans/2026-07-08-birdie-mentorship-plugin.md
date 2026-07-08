# Birdie Mentorship Capture Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Birdie — a local-first MCP server (plus a minimal REST API and one-page web UI) that captures before/after mentorship traces, lets an MCP-connected AI assistant extract lessons from them, gates promotion on human review, and serves two audiences (junior asking how a senior handled something, senior asking what a junior is struggling with) over the same reviewed pool.

**Architecture:** A single TypeScript/Node backend package with a repository layer over SQLite (`better-sqlite3`), a thin service layer enforcing the business rules (quote verification, domain-profile-validated typology, promotion gating), and two transports sharing that service layer: an MCP server (`fastmcp`, tools + prompts) and a REST API (`express`) backing a one-page React web UI. No LLM provider code anywhere — reasoning happens in whichever model is running the connected MCP host.

**Tech Stack:** TypeScript, Node.js, npm workspaces, `better-sqlite3`, `express`, `fastmcp`, `zod`, `vitest` + `supertest`, React + Vite for the web UI.

## Global Constraints

- v1 is **local-only**: single SQLite file, no auth, no multi-tenant, no deployed shared service.
- Birdie makes **zero LLM API calls** and holds no model credentials — all reasoning (extraction, ask synthesis) happens in the connected MCP host's model via tool calls.
- **Quote verification is done in code**, never delegated to the model — `quote` must be a verbatim substring of `before_text`.
- **Promotion always requires a human reviewer name** and is only possible from `status='pending_review'`.
- `typology` is **free text validated against the loaded domain profile** (`domain.md`), not a hardcoded enum — the profile must be swappable per-field (law, audit, tax, software, etc.) without a code change.
- All wire-facing data (REST JSON bodies/queries, MCP tool parameters, DB columns) uses **snake_case field names**, exactly matching the design spec's data model and API sections. Internal plumbing identifiers (class names, service/repository method names, local variables) use idiomatic camelCase.
- The web UI is **one page, two parts** (a capture form and a review queue) — no routing, no tabs, no separate library-browsing screen.
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
- Produces: `Trace`, `NewTrace`, `TraceStatus`, `Lesson`, `NewExtraction`, `LessonEdit`, `PromotePayload`, `LessonFilters`, `PlaybookAlignment`, `SubmittedByRole` — the domain types every later task imports from `backend/src/types.ts`.

- [ ] **Step 1: Create the root workspace `package.json`**

```json
{
  "name": "birdie",
  "private": true,
  "workspaces": ["backend", "web"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspace backend",
    "dev:backend": "npm run dev --workspace backend",
    "dev:web": "npm run dev --workspace web"
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
    "dev": "tsx src/cli.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "fastmcp": "^1.20.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
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
```

- [ ] **Step 7: Install dependencies and verify the build**

Run: `npm install` (from repo root)
Expected: installs succeed for the root and `backend` workspaces (the `web` workspace doesn't exist yet, so npm will just skip it).

Run: `npm run build --workspace backend`
Expected: `tsc` compiles `backend/src/types.ts` to `backend/dist/types.js` with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore backend/package.json backend/tsconfig.json backend/.env.example backend/src/types.ts backend/package-lock.json package-lock.json
git commit -m "Scaffold npm workspaces and backend domain types"
```

---

### Task 2: SQLite schema and repositories

**Files:**
- Create: `backend/src/db.ts`
- Create: `backend/src/repositories/traceRepository.ts`
- Create: `backend/src/repositories/lessonRepository.ts`
- Test: `backend/test/repositories.test.ts`

**Interfaces:**
- Consumes: `Trace`, `NewTrace`, `TraceStatus`, `Lesson`, `NewExtraction`, `LessonEdit`, `LessonFilters`, `PromotePayload` from `backend/src/types.ts` (Task 1).
- Produces: `openDb(dbPath: string): Database.Database`; `class TraceRepository` with `create(input: NewTrace): Trace`, `getById(id: string): Trace | undefined`, `list(status?: TraceStatus): Trace[]`, `markExtracted(id: string): void`, `markSkipped(id: string, reason: string): void`; `class LessonRepository` with `create(input: NewExtraction & { quote_verified: boolean }): Lesson`, `getById(id: string): Lesson | undefined`, `list(filters: LessonFilters): Lesson[]`, `edit(id: string, changes: LessonEdit): Lesson`, `promote(id: string, payload: PromotePayload): Lesson`. Both repositories take a `Database.Database` instance in their constructor.

- [ ] **Step 1: Create `backend/src/db.ts`**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
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
    CREATE INDEX IF NOT EXISTS idx_lessons_trace_id ON lessons(trace_id);
  `);
}
```

- [ ] **Step 2: Write the failing repository tests**

Create `backend/test/repositories.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';

describe('TraceRepository', () => {
  let db: Database.Database;
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
  let db: Database.Database;
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

Run: `npm run test --workspace backend`
Expected: FAIL — `Cannot find module '../src/repositories/traceRepository.js'` (the repository files don't exist yet).

- [ ] **Step 4: Create `backend/src/repositories/traceRepository.ts`**

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { NewTrace, Trace, TraceStatus } from '../types.js';

export class TraceRepository {
  constructor(private db: Database.Database) {}

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
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Lesson, LessonEdit, LessonFilters, NewExtraction, PromotePayload } from '../types.js';

interface LessonRow extends Omit<Lesson, 'quote_verified'> {
  quote_verified: number;
}

function rowToLesson(row: LessonRow): Lesson {
  return { ...row, quote_verified: row.quote_verified === 1 };
}

export class LessonRepository {
  constructor(private db: Database.Database) {}

  create(input: NewExtraction & { quote_verified: boolean }): Lesson {
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

  getById(id: string): Lesson | undefined {
    const row = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
    return row ? rowToLesson(row) : undefined;
  }

  list(filters: LessonFilters): Lesson[] {
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
      .prepare(`SELECT l.* FROM lessons l JOIN traces t ON t.id = l.trace_id ${where} ORDER BY l.created_at DESC`)
      .all(params) as LessonRow[];
    return rows.map(rowToLesson);
  }

  edit(id: string, changes: LessonEdit): Lesson {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    const next = {
      quote: changes.quote ?? current.quote,
      what_changed: changes.what_changed ?? current.what_changed,
      why_it_matters: changes.why_it_matters ?? current.why_it_matters,
      typology: changes.typology ?? current.typology,
      status: changes.status ?? current.status,
    };
    this.db
      .prepare(
        `UPDATE lessons SET quote = @quote, what_changed = @what_changed, why_it_matters = @why_it_matters, typology = @typology, status = @status WHERE id = @id`
      )
      .run({ id, ...next });
    return this.getById(id)!;
  }

  promote(id: string, payload: PromotePayload): Lesson {
    const current = this.getById(id);
    if (!current) throw new Error(`Lesson not found: ${id}`);
    if (current.status !== 'pending_review') {
      throw new Error(`Lesson ${id} cannot be promoted from status '${current.status}'`);
    }
    const next = {
      quote: payload.quote ?? current.quote,
      what_changed: payload.what_changed ?? current.what_changed,
      why_it_matters: payload.why_it_matters ?? current.why_it_matters,
      typology: payload.typology ?? current.typology,
    };
    this.db
      .prepare(
        `UPDATE lessons SET quote = @quote, what_changed = @what_changed, why_it_matters = @why_it_matters, typology = @typology,
         status = 'promoted', reviewer = @reviewer, reviewed_at = @now, promoted_at = @now WHERE id = @id`
      )
      .run({ id, ...next, reviewer: payload.reviewer, now: new Date().toISOString() });
    return this.getById(id)!;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace backend`
Expected: PASS (9 tests passed: 3 in `TraceRepository`, 6 in `LessonRepository`).

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
import { describe, it, expect } from 'vitest';
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

  it('treats an empty quote as trivially verified', () => {
    expect(verifyQuote('', 'The party shall indemnify all losses.')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace backend -- extraction`
Expected: FAIL — `Cannot find module '../src/extraction.js'`.

- [ ] **Step 3: Create `backend/src/extraction.ts`**

```typescript
export function verifyQuote(quote: string, beforeText: string): boolean {
  return beforeText.includes(quote);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace backend -- extraction`
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
import { describe, it, expect } from 'vitest';
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

Run: `npm run test --workspace backend -- domain`
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

Run: `npm run test --workspace backend -- domain`
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
- Produces: `class TraceService` with `capture(input: NewTrace): Trace`, `get(id: string): Trace | undefined`, `list(status?: TraceStatus): Trace[]`, `skip(id: string, reason: string): Trace`, `extract(input: NewExtraction): Lesson`. `class LessonService` with `list(filters: LessonFilters): Lesson[]`, `get(id: string): Lesson | undefined`, `review(id: string, changes: LessonEdit): Lesson`, `promote(id: string, payload: PromotePayload): Lesson`. Both are consumed by the MCP tools (Task 6) and REST routes (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/services.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';

describe('TraceService + LessonService', () => {
  let db: Database.Database;
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    traceService = new TraceService(traceRepo, lessonRepo, profile);
    lessonService = new LessonService(lessonRepo);
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace backend -- services`
Expected: FAIL — `Cannot find module '../src/services/traceService.js'`.

- [ ] **Step 3: Create `backend/src/services/traceService.ts`**

```typescript
import type { TraceRepository } from '../repositories/traceRepository.js';
import type { LessonRepository } from '../repositories/lessonRepository.js';
import type { DomainProfile } from '../domain.js';
import { verifyQuote } from '../extraction.js';
import type { Lesson, NewExtraction, NewTrace, Trace, TraceStatus } from '../types.js';

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

  extract(input: NewExtraction): Lesson {
    const trace = this.traces.getById(input.trace_id);
    if (!trace) throw new Error(`Trace not found: ${input.trace_id}`);
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
import type { Lesson, LessonEdit, LessonFilters, PromotePayload } from '../types.js';

export class LessonService {
  constructor(private lessons: LessonRepository) {}

  list(filters: LessonFilters): Lesson[] {
    return this.lessons.list(filters);
  }

  get(id: string): Lesson | undefined {
    return this.lessons.getById(id);
  }

  review(id: string, changes: LessonEdit): Lesson {
    return this.lessons.edit(id, changes);
  }

  promote(id: string, payload: PromotePayload): Lesson {
    return this.lessons.promote(id, payload);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace backend -- services`
Expected: PASS (5 tests passed).

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
- Consumes: `TraceService`, `LessonService` (Task 5), `openDb` (Task 2), `loadDomainProfile` (Task 4).
- Produces: `interface AppContext { traceService: TraceService; lessonService: LessonService; domainProfile: DomainProfile }`; `buildContext(): AppContext`; `interface ToolContext { traceService: TraceService; lessonService: LessonService }`; handler functions `captureTraceHandler`, `getTraceHandler`, `skipExtractionHandler`, `saveExtractionHandler`, `listLessonsHandler`, `reviewLessonHandler`, `promoteLessonHandler`; `registerTools(server: FastMCP, ctx: ToolContext): void`; `createMcpServer(ctx: ToolContext, domainProfile: DomainProfile): FastMCP`. Used by `cli.ts` (Task 10) and extended by Task 7 (ask tools) and Task 8 (prompts).

- [ ] **Step 1: Create `backend/src/context.ts`**

```typescript
import { openDb } from './db.js';
import { TraceRepository } from './repositories/traceRepository.js';
import { LessonRepository } from './repositories/lessonRepository.js';
import { TraceService } from './services/traceService.js';
import { LessonService } from './services/lessonService.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';

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
    lessonService: new LessonService(lessonRepo),
    domainProfile,
  };
}
```

- [ ] **Step 2: Write the failing tool handler tests**

Create `backend/test/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';
import {
  captureTraceHandler,
  getTraceHandler,
  saveExtractionHandler,
  skipExtractionHandler,
  promoteLessonHandler,
  type ToolContext,
} from '../src/mcp/tools.js';

describe('MCP tool handlers', () => {
  let db: Database.Database;
  let ctx: ToolContext;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    ctx = {
      traceService: new TraceService(traceRepo, lessonRepo, profile),
      lessonService: new LessonService(lessonRepo),
    };
  });

  it('captures a trace and reads it back via get_trace', () => {
    const trace = captureTraceHandler(ctx, {
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    const fetched = getTraceHandler(ctx, { trace_id: trace.id });
    expect(fetched.before_text).toBe('uncapped indemnity');
  });

  it('saves an extraction and then promotes it', () => {
    const trace = captureTraceHandler(ctx, {
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
      junior_name: 'Jane',
      senior_name: 'Sarah',
    });
    const lesson = saveExtractionHandler(ctx, {
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped the indemnity.',
      why_it_matters: 'Risk control.',
      typology: 'substantive_risk',
    });
    expect(lesson.quote_verified).toBe(true);
    const promoted = promoteLessonHandler(ctx, { lesson_id: lesson.id, reviewer: 'Sarah' });
    expect(promoted.status).toBe('promoted');
  });

  it('skips a trace instead of extracting when not mentorship-worthy', () => {
    const trace = captureTraceHandler(ctx, {
      before_text: 'teh',
      after_text: 'the',
      submitted_by: 'Jane',
      submitted_by_role: 'junior',
    });
    const skipped = skipExtractionHandler(ctx, { trace_id: trace.id, reason: 'Typo fix only.' });
    expect(skipped.status).toBe('skipped');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test --workspace backend -- tools`
Expected: FAIL — `Cannot find module '../src/mcp/tools.js'`.

- [ ] **Step 4: Create `backend/src/mcp/tools.ts`**

```typescript
import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { TraceService } from '../services/traceService.js';
import type { LessonService } from '../services/lessonService.js';

export interface ToolContext {
  traceService: TraceService;
  lessonService: LessonService;
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
  quote: z.string().optional(),
  what_changed: z.string().optional(),
  why_it_matters: z.string().optional(),
  typology: z.string().optional(),
  reject: z.boolean().optional(),
});

export const promoteLessonParams = z.object({
  lesson_id: z.string().min(1),
  reviewer: z.string().min(1),
  quote: z.string().optional(),
  what_changed: z.string().optional(),
  why_it_matters: z.string().optional(),
  typology: z.string().optional(),
});

export function captureTraceHandler(ctx: ToolContext, args: z.infer<typeof captureTraceParams>) {
  return ctx.traceService.capture(args);
}

export function getTraceHandler(ctx: ToolContext, args: z.infer<typeof getTraceParams>) {
  const trace = ctx.traceService.get(args.trace_id);
  if (!trace) throw new Error(`Trace not found: ${args.trace_id}`);
  return trace;
}

export function skipExtractionHandler(ctx: ToolContext, args: z.infer<typeof skipExtractionParams>) {
  return ctx.traceService.skip(args.trace_id, args.reason);
}

export function saveExtractionHandler(ctx: ToolContext, args: z.infer<typeof saveExtractionParams>) {
  return ctx.traceService.extract(args);
}

export function listLessonsHandler(ctx: ToolContext, args: z.infer<typeof listLessonsParams>) {
  return ctx.lessonService.list(args);
}

export function reviewLessonHandler(ctx: ToolContext, args: z.infer<typeof reviewLessonParams>) {
  const { lesson_id, reject, ...fields } = args;
  return ctx.lessonService.review(lesson_id, { ...fields, status: reject ? 'rejected' : undefined });
}

export function promoteLessonHandler(ctx: ToolContext, args: z.infer<typeof promoteLessonParams>) {
  const { lesson_id, ...payload } = args;
  return ctx.lessonService.promote(lesson_id, payload);
}

export function registerTools(server: FastMCP, ctx: ToolContext): void {
  server.addTool({
    name: 'capture_trace',
    description: 'Capture a before/after edit as a trace for later extraction into a mentorship lesson.',
    parameters: captureTraceParams,
    execute: async (args) => JSON.stringify(captureTraceHandler(ctx, args)),
  });
  server.addTool({
    name: 'get_trace',
    description: "Read a trace's before/after/playbook text to reason over before extracting a lesson.",
    parameters: getTraceParams,
    execute: async (args) => JSON.stringify(getTraceHandler(ctx, args)),
  });
  server.addTool({
    name: 'skip_extraction',
    description: 'Mark a trace as not mentorship-worthy instead of forcing a lesson out of it.',
    parameters: skipExtractionParams,
    execute: async (args) => JSON.stringify(skipExtractionHandler(ctx, args)),
  });
  server.addTool({
    name: 'save_extraction',
    description: 'Persist an extracted lesson: quote, what changed, why it matters, typology, and playbook alignment.',
    parameters: saveExtractionParams,
    execute: async (args) => JSON.stringify(saveExtractionHandler(ctx, args)),
  });
  server.addTool({
    name: 'list_lessons',
    description: 'List lessons, filterable by status, typology, playbook_ref, junior_name, senior_name.',
    parameters: listLessonsParams,
    execute: async (args) => JSON.stringify(listLessonsHandler(ctx, args)),
  });
  server.addTool({
    name: 'review_lesson',
    description: 'Edit a pending lesson in place, or reject it.',
    parameters: reviewLessonParams,
    execute: async (args) => JSON.stringify(reviewLessonHandler(ctx, args)),
  });
  server.addTool({
    name: 'promote_lesson',
    description: 'Promote a reviewed lesson into the shared pool, requiring a reviewer name.',
    parameters: promoteLessonParams,
    execute: async (args) => JSON.stringify(promoteLessonHandler(ctx, args)),
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

Run: `npm run test --workspace backend -- tools`
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
- Produces (added to `LessonRepository`): `searchPromoted(question: string, senior_name?: string): Lesson[]`, `strugglesFor(junior_name?: string): { lessons: Lesson[]; typology_counts: Record<string, number> }`.
- Produces (added to `LessonService`): `askSeniorApproach(question: string, senior_name?: string): Lesson[]`, `askJuniorStruggles(junior_name?: string): { lessons: Lesson[]; typology_counts: Record<string, number> }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/ask.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { TraceRepository } from '../src/repositories/traceRepository.js';
import { LessonRepository } from '../src/repositories/lessonRepository.js';
import { TraceService } from '../src/services/traceService.js';
import { LessonService } from '../src/services/lessonService.js';
import { loadDomainProfile } from '../src/domain.js';

describe('ask_senior_approach / ask_junior_struggles', () => {
  let db: Database.Database;
  let traceService: TraceService;
  let lessonService: LessonService;

  beforeEach(() => {
    db = openDb(':memory:');
    const traceRepo = new TraceRepository(db);
    const lessonRepo = new LessonRepository(db);
    const profile = loadDomainProfile('/nonexistent/domain.md');
    traceService = new TraceService(traceRepo, lessonRepo, profile);
    lessonService = new LessonService(lessonRepo);

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

Run: `npm run test --workspace backend -- ask`
Expected: FAIL — `lessonService.askSeniorApproach is not a function`.

- [ ] **Step 3: Add `searchPromoted` and `strugglesFor` to `backend/src/repositories/lessonRepository.ts`**

Add these two methods inside the `LessonRepository` class, after `promote`:

```typescript
  searchPromoted(question: string, senior_name?: string): Lesson[] {
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
      .prepare(`SELECT l.* FROM lessons l JOIN traces t ON t.id = l.trace_id WHERE ${clauses.join(' AND ')} ORDER BY l.promoted_at DESC`)
      .all(params) as LessonRow[];
    return rows.map(rowToLesson);
  }

  strugglesFor(junior_name?: string): { lessons: Lesson[]; typology_counts: Record<string, number> } {
    const clauses = ["l.status = 'promoted'"];
    const params: Record<string, string> = {};
    if (junior_name) {
      clauses.push('t.junior_name = @junior_name');
      params.junior_name = junior_name;
    }
    const rows = this.db
      .prepare(`SELECT l.* FROM lessons l JOIN traces t ON t.id = l.trace_id WHERE ${clauses.join(' AND ')} ORDER BY l.promoted_at DESC`)
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
  askSeniorApproach(question: string, senior_name?: string): Lesson[] {
    return this.lessons.searchPromoted(question, senior_name);
  }

  askJuniorStruggles(junior_name?: string): { lessons: Lesson[]; typology_counts: Record<string, number> } {
    return this.lessons.strugglesFor(junior_name);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace backend -- ask`
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
export function askSeniorApproachHandler(ctx: ToolContext, args: z.infer<typeof askSeniorApproachParams>) {
  return ctx.lessonService.askSeniorApproach(args.question, args.senior_name);
}

export function askJuniorStrugglesHandler(ctx: ToolContext, args: z.infer<typeof askJuniorStrugglesParams>) {
  return ctx.lessonService.askJuniorStruggles(args.junior_name);
}
```

Add these two registrations inside `registerTools`, after the `promote_lesson` tool:

```typescript
  server.addTool({
    name: 'ask_senior_approach',
    description: 'Find promoted lessons matching a question, optionally filtered to one senior.',
    parameters: askSeniorApproachParams,
    execute: async (args) => JSON.stringify(askSeniorApproachHandler(ctx, args)),
  });
  server.addTool({
    name: 'ask_junior_struggles',
    description: 'Summarize promoted lessons for a junior (or all juniors) with a typology breakdown.',
    parameters: askJuniorStrugglesParams,
    execute: async (args) => JSON.stringify(askJuniorStrugglesHandler(ctx, args)),
  });
```

- [ ] **Step 7: Run the full backend test suite to verify nothing broke**

Run: `npm run test --workspace backend`
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
import { describe, it, expect } from 'vitest';
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

Run: `npm run test --workspace backend -- prompts`
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

Run: `npm run test --workspace backend -- prompts`
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

Run: `npm run test --workspace backend`
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
- Produces: `tracesRouter(ctx: AppContext): Router`, `lessonsRouter(ctx: AppContext): Router`, `createServer(ctx: AppContext): Express`. Used by `cli.ts` (Task 10).

- [ ] **Step 1: Write the failing REST tests**

Create `backend/test/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
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
    lessonService: new LessonService(lessonRepo),
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace backend -- routes`
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
    const status = req.query.status as string | undefined;
    res.json(ctx.traceService.list(status as never));
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
  quote: z.string().optional(),
  what_changed: z.string().optional(),
  why_it_matters: z.string().optional(),
  typology: z.string().optional(),
  reject: z.boolean().optional(),
});

const promoteLessonBody = z.object({
  reviewer: z.string().min(1),
  quote: z.string().optional(),
  what_changed: z.string().optional(),
  why_it_matters: z.string().optional(),
  typology: z.string().optional(),
});

export function lessonsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { status, typology, playbook_ref, junior_name, senior_name } = req.query;
    res.json(
      ctx.lessonService.list({
        status: status as never,
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
      res.status(404).json({ error: (err as Error).message });
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
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 5: Create `backend/src/server.ts`**

```typescript
import express, { type Express } from 'express';
import type { AppContext } from './context.js';
import { tracesRouter } from './routes/traces.js';
import { lessonsRouter } from './routes/lessons.js';

export function createServer(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());
  app.use('/traces', tracesRouter(ctx));
  app.use('/lessons', lessonsRouter(ctx));
  return app;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace backend -- routes`
Expected: PASS (4 tests passed).

- [ ] **Step 7: Run the full backend test suite**

Run: `npm run test --workspace backend`
Expected: PASS (all tests across all files, backend done).

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
- Consumes: `buildContext` (Task 6), `createServer` (Task 9), `createMcpServer` (Task 8).

- [ ] **Step 1: Create `backend/src/cli.ts`**

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { buildContext } from './context.js';
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
    const server = createMcpServer(ctx, ctx.domainProfile);
    await server.start({ transportType: 'stdio' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the `web` mode starts and serves requests**

Run: `cd backend && DB_PATH=:memory: PORT=4001 npx tsx src/cli.ts web`
Expected: prints `Birdie REST API + web UI listening on http://localhost:4001` and keeps running.

In a second terminal, run:

```bash
curl -s -X POST http://localhost:4001/traces \
  -H 'Content-Type: application/json' \
  -d '{"before_text":"uncapped indemnity","after_text":"capped indemnity","submitted_by":"Jane","submitted_by_role":"junior"}'
```

Expected: a JSON response with `"status":"captured"` and a generated `id`. Stop the server with Ctrl+C afterward.

- [ ] **Step 3: Verify the `mcp` mode starts without crashing**

Run: `cd backend && DB_PATH=:memory: npx tsx src/cli.ts mcp`
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
- Consumes: the REST API from Task 9 (`POST /traces`, `GET /lessons`, `PATCH /lessons/:id`, `POST /lessons/:id/promote`) via `fetch`.
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
  quote: string;
  quote_verified: boolean;
  what_changed: string;
  why_it_matters: string;
  typology: string;
  playbook_alignment: 'aligned' | 'diverges' | 'not_applicable' | null;
  playbook_note: string | null;
  status: 'pending_review' | 'rejected' | 'promoted';
  reviewer: string | null;
  created_at: string;
}

export type NewTrace = Pick<Trace, 'before_text' | 'after_text' | 'submitted_by' | 'submitted_by_role'> &
  Partial<Pick<Trace, 'junior_name' | 'senior_name' | 'playbook_ref' | 'playbook_text' | 'context_note'>>;

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
import { listLessons, promoteLesson, reviewLesson, type Lesson } from './api.js';

interface Props {
  refreshSignal: number;
}

export default function ReviewList({ refreshSignal }: Props) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [reviewerById, setReviewerById] = useState<Record<string, string>>({});

  async function refresh() {
    setLessons(await listLessons('pending_review'));
  }

  useEffect(() => {
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
            <input value={lesson.typology} onChange={(e) => updateField(lesson.id, 'typology', e.target.value)} />
          </label>
          <label>
            Reviewer name
            <input
              value={reviewerById[lesson.id] ?? ''}
              onChange={(e) => setReviewerById((prev) => ({ ...prev, [lesson.id]: e.target.value }))}
            />
          </label>
          <button onClick={() => handlePromote(lesson)}>Confirm & Promote</button>
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

Run: `npm install` (from repo root — picks up the new `web` workspace)
Expected: installs succeed for the `web` workspace.

Run: `npm run build --workspace web`
Expected: `tsc -b && vite build` completes with no type errors, producing `web/dist/`.

- [ ] **Step 11: Manual smoke check**

Run: `cd backend && DB_PATH=./data/birdie.db PORT=4000 npx tsx src/cli.ts web` in one terminal, and `npm run dev --workspace web` in another. Open the printed Vite URL in a browser, submit a trace via the Capture form, and confirm no console errors. (The Review queue will show nothing until a lesson is extracted via an MCP-connected assistant, which requires Task 12's registration — that's expected at this point.)

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "Add one-page web UI: capture form + review queue"
```

---

### Task 12: Claude Code Skill wrapper

**Files:**
- Create: `skills/birdie-mentor/SKILL.md`

- [ ] **Step 1: Create `skills/birdie-mentor/SKILL.md`**

```markdown
---
name: birdie-mentor
description: Capture a before/after edit as a mentorship trace, extract a lesson from it, review, promote, or ask what a senior/junior has done - use when the user wants to log a redline/edit for mentorship, review pending lessons, or ask about past senior approaches or junior struggles captured in Birdie.
---

# Birdie Mentor

Birdie is an MCP server (registered separately - see the project README) for capturing mentorship moments: a senior's edit to a junior's draft, turned into a reviewed, reusable lesson.

Use the `birdie` MCP tools and prompts directly - this skill just orients you on the workflow, it adds no logic beyond what the MCP prompts already specify.

## Capturing and extracting a lesson

1. If the user describes a before/after edit that hasn't been captured yet, call `capture_trace` with the before/after text, who submitted it, their role, and (if known) the junior/senior names involved.
2. To turn a captured trace into a lesson, use the `extract-lesson` MCP prompt (or manually: call `get_trace`, decide if it's mentorship-worthy per the loaded domain profile, then call `save_extraction` or `skip_extraction`).

## Reviewing and promoting

Call `list_lessons` with `status=pending_review` to see what's waiting. Use `review_lesson` to edit or reject, and `promote_lesson` (with a reviewer name) to publish a lesson into the shared pool. Promotion always requires a human reviewer - never promote a lesson the user hasn't actually looked at.

## Asking the two audiences

- A junior asking how a senior handled something: use the `ask-senior-approach` MCP prompt (or call `ask_senior_approach` directly).
- A senior asking what a junior is struggling with: use the `ask-junior-struggles` MCP prompt (or call `ask_junior_struggles` directly).

Both only search **promoted** lessons - if nothing comes back, say so; don't invent an answer.

## Adapting to a different domain

Birdie's typology and "what's mentorship-worthy" criteria come from `domain.md` at the project root, not from this skill. If the user is in a different field (audit, tax, software, etc.), point them at editing that file rather than trying to override the taxonomy here.
```

- [ ] **Step 2: Commit**

```bash
git add skills/birdie-mentor/SKILL.md
git commit -m "Add thin Claude Code Skill wrapper over the Birdie MCP tools/prompts"
```

---

### Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Birdie

A minimalistic mentorship-capture plugin. Capture a before/after edit (a senior's redline of a junior's draft), let your connected AI assistant extract a candidate lesson from it, review it, and promote it into a pool two audiences can query: juniors asking how a senior handled something, and seniors asking what a junior is struggling with.

Birdie is an MCP server with no LLM of its own - the model reasoning over your traces is whichever one is running your connected MCP host (Claude Code, Claude Desktop, Codex CLI, or any other MCP-compatible client). See `docs/superpowers/specs/2026-07-08-birdie-mentorship-plugin-design.md` for the full design.

## Setup

\`\`\`bash
npm install
cp backend/.env.example backend/.env
\`\`\`

Edit `domain.md` at the repo root to match your field - it ships with a legal example, but the typology and "what's mentorship-worthy" criteria are meant to be replaced for audit, tax, software review, or anything else.

## Running

\`\`\`bash
npm run dev:backend -- mcp   # MCP server only (stdio)
npm run dev:backend -- web   # REST API + web UI on http://localhost:4000
npm run dev:backend          # both
npm run dev:web              # Vite dev server for the web UI (proxies API calls to :4000)
\`\`\`

## Registering as an MCP server

Point your MCP host's config at the backend's `mcp` mode, e.g. in Claude Code / Claude Desktop:

\`\`\`json
{
  "mcpServers": {
    "birdie": {
      "command": "npx",
      "args": ["tsx", "backend/src/cli.ts", "mcp"],
      "cwd": "/path/to/birdie"
    }
  }
}
\`\`\`

## Testing

\`\`\`bash
npm run test --workspace backend
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add project README"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered section of the design spec (§1–§13) maps to a task: data model → Task 1/2, quote verification → Task 3, domain profile → Task 4, core services → Task 5, MCP tools → Task 6/7, MCP prompts → Task 8, REST → Task 9, run modes/CLI → Task 10, one-page web UI → Task 11, Skill wrapper → Task 12, README → Task 13.
- **Naming consistency:** all wire-facing fields (types.ts, repositories, services' public method signatures for domain data, zod schemas, REST bodies, web `api.ts`) use snake_case matching the spec's §5/§8 field names exactly; only class names, method names, and non-domain local variables use camelCase. Verified `Lesson`/`Trace`/`NewExtraction`/`LessonEdit`/`PromotePayload`/`LessonFilters` field names are identical across Task 1 (definition), Task 2 (repositories), Task 5 (services), Task 6/7 (MCP tools), and Task 9 (REST routes).
- **No placeholders:** every step has complete, runnable code — no TODOs or "add validation here" stubs.
