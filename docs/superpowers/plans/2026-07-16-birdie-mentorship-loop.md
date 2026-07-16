# Birdie Mentorship Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Birdie from a set of lesson CRUD operations into a simple correction-to-guidance product that captures one three-part lesson atomically, reviews it without hierarchy, detects repeated guidance, and proactively checks current work for relevant promoted lessons.

**Architecture:** Preserve the existing `quote`, `what_changed`, and `why_it_matters` storage fields while presenting them as “What was initially wrong,” “What to do instead,” and “Why it matters.” Add outcome-oriented service operations above the current stores: atomic correction capture, bounded-context guidance retrieval, and duplicate evidence merging. The connected LLM continues to make extraction and high-confidence relevance judgments; Birdie verifies evidence, enforces review state, retrieves candidates, and records merge metadata.

**Tech Stack:** Bun 1.3.11, TypeScript, Express, FastMCP, Zod, SQLite/FTS5, PostgreSQL/pgvector, React 18, Vite, Bun test.

## Global Constraints

- Birdie's primary promise is “Stop giving the same correction twice.”
- There are no mentor, learner, senior, or junior account roles.
- A lesson exposes exactly three editable content fields: `quote`, `what_changed`, and `why_it_matters`.
- `quote` must be a verbatim excerpt of `before_text`; an unverified quote cannot be promoted.
- `what_changed` is presented as “What to do instead.”
- `why_it_matters` is drafted by the connected LLM and remains fully editable.
- Nothing is promoted or merged without an explicit human action.
- Context checks use bounded input and are not persisted.
- Low-confidence retrieval remains silent; search similarity alone never authorizes an interruption.
- MCP remains one adapter. Keep the REST and service operations usable by other clients.
- Keep SQLite and PostgreSQL behavior aligned.
- Preserve existing tools and routes for compatibility while adding the outcome-oriented operations.
- Use focused tests; do not expand unrelated test coverage.

---

### Task 1: Atomic correction capture and grounded promotion

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/services/traceService.ts`
- Modify: `backend/src/services/lessonService.ts`
- Modify: `backend/src/routes/traces.ts`
- Modify: `backend/src/mcp/tools.ts`
- Test: `backend/test/services.test.ts`
- Test: `backend/test/mcpGuidance.test.ts`

**Interfaces:**
- Produces: `NewCorrection`, containing `NewTrace` plus the three lesson fields.
- Produces: `TraceService.captureCorrection(input: NewCorrection): Promise<LessonWithTrace>`.
- Produces: `POST /traces/capture-correction`.
- Produces: MCP tool `capture_correction`.
- Guarantees: `LessonService.promote()` rejects an unverified final quote.

- [ ] **Step 1: Write failing service tests for atomic capture and promotion grounding**

Add this case to the existing `services` describe block in `backend/test/services.test.ts`, which already creates `traceService` and `lessonService` in `beforeEach`:

```ts
it('captures correction evidence and its pending three-part lesson atomically', async () => {
  const lesson = await traceService.captureCorrection({
    submitted_by: 'Alex',
    submitted_by_user_id: null,
    before_text: 'Send the update when you can.',
    after_text: 'Send the update by Friday at 3pm.',
    quote: 'when you can',
    what_changed: 'Give the recipient a concrete deadline.',
    why_it_matters: 'A concrete deadline makes ownership and follow-up unambiguous.',
  });

  expect(lesson.status).toBe('pending_review');
  expect(lesson.quote_verified).toBe(true);
  expect((await traceService.get(lesson.trace_id))?.status).toBe('extracted');
});

it('blocks promotion when the final quote is not grounded in the original work', async () => {
  const trace = await traceService.capture({
    submitted_by: 'Alex',
    before_text: 'Send the update when you can.',
    after_text: 'Send the update by Friday at 3pm.',
  });
  const lesson = await traceService.extract({
    trace_id: trace.id,
    quote: 'when you can',
    what_changed: 'Give the recipient a concrete deadline.',
    why_it_matters: 'A concrete deadline makes ownership and follow-up unambiguous.',
  });

  await expect(lessonService.promote(lesson.id, {
    quote: 'invented wording',
    reviewer: 'Morgan',
    reviewer_user_id: null,
  })).rejects.toThrow('verified quote');
  expect((await lessonService.get(lesson.id))?.status).toBe('pending_review');
});
```

- [ ] **Step 2: Run the service tests and confirm the new behavior fails**

Run:

```bash
bun test backend/test/services.test.ts
```

Expected: FAIL because `captureCorrection` does not exist and promotion currently accepts an unverified edited quote.

- [ ] **Step 3: Add the atomic correction type and service method**

Add to `backend/src/types.ts`:

```ts
export interface NewCorrection extends NewTrace {
  quote: string;
  what_changed: string;
  why_it_matters: string;
}
```

Add to `TraceService` in `backend/src/services/traceService.ts`:

```ts
async captureCorrection(input: NewCorrection): Promise<LessonWithTrace> {
  return this.db.transaction(async (session) => {
    const { quote, what_changed, why_it_matters, ...traceInput } = input;
    const trace = await session.traces.create(traceInput);
    const lesson = await session.lessons.create({
      trace_id: trace.id,
      quote,
      what_changed,
      why_it_matters,
      quote_verified: verifyQuote(quote, trace.before_text),
    });
    await session.traces.markExtracted(trace.id);
    return lesson;
  });
}
```

Import `NewCorrection` alongside the existing trace types.

- [ ] **Step 4: Block promotion when the resulting quote is unverified**

In `LessonService.promote()`, calculate the final verification state before calling the store:

```ts
const quoteVerified = payload.quote === undefined
  ? current.quote_verified
  : await this.verifyLessonQuote(session, current.trace_id, payload.quote);
if (!quoteVerified) {
  throw new Error('A verified quote from the original work is required before promotion');
}
return session.lessons.promote(id, { ...payload, quote_verified: true });
```

- [ ] **Step 5: Add failing MCP contract tests**

Extend the existing `describes the same lifecycle on raw MCP tools` case in `backend/test/mcpGuidance.test.ts`:

```ts
expect(descriptions.get('capture_correction')).toContain('three-part');
expect(descriptions.get('capture_correction')).toContain('same turn');
expect(descriptions.get('capture_correction')).toContain('before_text');
```

- [ ] **Step 6: Run the MCP contract test and confirm it fails**

Run:

```bash
bun test backend/test/mcpGuidance.test.ts
```

Expected: FAIL because the tool does not exist.

- [ ] **Step 7: Add the outcome-oriented REST route and MCP tool**

In `backend/src/routes/traces.ts`, declare a body schema and register the static route before `/:id` routes:

```ts
const captureCorrectionBody = createTraceBody.extend({
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
});

router.post('/capture-correction', requireScope('birdie:write'), async (req, res) => {
  const parsed = captureCorrectionBody.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  try {
    res.status(201).json(await ctx.traceService.captureCorrection({
      ...parsed.data,
      submitted_by: req.user!.name,
      submitted_by_user_id: req.user!.id,
    }));
  } catch (err) {
    sendServiceError(res, err);
  }
});
```

In `backend/src/mcp/tools.ts`, add `captureCorrectionParams` with the same fields and register:

```ts
server.addTool({
  name: 'capture_correction',
  description: 'Capture grounded before_text and after_text plus the three-part lesson in one transaction. The quote must come from before_text; what_changed says what to do instead; why_it_matters explains the transferable significance. Leave the result pending_review.',
  parameters: captureCorrectionParams,
  canAccess: hasScope('birdie:write'),
  execute: async (args, request) => {
    const user = requireSession(request.session).user;
    return json(await ctx.traceService.captureCorrection({
      ...args,
      submitted_by: user.name,
      submitted_by_user_id: user.id,
    }));
  },
});
```

Keep `capture_trace` and `save_extraction` for compatible clients.

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun test backend/test/services.test.ts backend/test/mcpGuidance.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add backend/src/types.ts backend/src/services/traceService.ts backend/src/services/lessonService.ts backend/src/routes/traces.ts backend/src/mcp/tools.ts backend/test/services.test.ts backend/test/mcpGuidance.test.ts
git commit -m "feat: capture grounded lessons atomically"
```

---

### Task 2: Contextual guidance checks through the connected LLM

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/services/lessonService.ts`
- Modify: `backend/src/routes/lessons.ts`
- Modify: `backend/src/mcp/tools.ts`
- Modify: `backend/src/mcp/prompts.ts`
- Modify: `skills/birdie-mentor/SKILL.md`
- Test: `backend/test/services.test.ts`
- Test: `backend/test/mcpGuidance.test.ts`
- Test: `backend/test/birdieMentorSkill.test.ts`

**Interfaces:**
- Consumes: promoted lessons from `LessonStore.list()`.
- Produces: `GuidanceContext` and `GuidanceCheckResult`.
- Produces: `LessonService.checkGuidance(context): Promise<GuidanceCheckResult>`.
- Produces: `POST /lessons/check-guidance` and MCP tool `check_guidance`.
- Produces: a client rubric that distinguishes retrieval from permission to interrupt.

- [ ] **Step 1: Write failing service tests for bounded contextual retrieval**

Add to `backend/test/services.test.ts`:

```ts
it('shortlists only promoted guidance from bounded task context', async () => {
  const promotedTrace = await traceService.capture({
    submitted_by: 'Alex',
    before_text: 'Send the update soon.',
    after_text: 'Send the update by Friday.',
  });
  const promotedDraft = await traceService.extract({
    trace_id: promotedTrace.id,
    quote: 'soon',
    what_changed: 'Use a concrete deadline.',
    why_it_matters: 'Concrete deadlines make client follow-up clear.',
  });
  const promoted = await lessonService.promote(promotedDraft.id, { reviewer: 'Morgan' });

  const pendingTrace = await traceService.capture({
    submitted_by: 'Sam',
    before_text: 'Add a greeting.',
    after_text: 'Hello Morgan,',
  });
  const pending = await traceService.extract({
    trace_id: pendingTrace.id,
    quote: 'Add a greeting.',
    what_changed: 'Address the recipient by name.',
    why_it_matters: 'A named greeting makes the message personal.',
  });

  const result = await lessonService.checkGuidance({
    task: 'Draft a client update with a firm delivery date',
    artifact_type: 'email',
    stage: 'before final response',
  });

  expect(result.outcome).toBe('available');
  expect(result.candidates.map((lesson) => lesson.id)).toContain(promoted.id);
  expect(result.candidates.map((lesson) => lesson.id)).not.toContain(pending.id);
  expect(result.candidates.length).toBeLessThanOrEqual(5);
});

it('returns none without persisting context when no guidance matches', async () => {
  const result = await lessonService.checkGuidance({ task: 'Tune a bicycle brake' });
  expect(result).toEqual({ outcome: 'none', candidates: [] });
});
```

- [ ] **Step 2: Run the service tests and confirm they fail**

Run:

```bash
bun test backend/test/services.test.ts
```

Expected: FAIL because `checkGuidance` and its types do not exist.

- [ ] **Step 3: Add the context and result types**

Add to `backend/src/types.ts`:

```ts
export interface GuidanceContext {
  task: string;
  artifact_type?: string;
  stage?: string;
  workspace?: string;
  relevant_excerpt?: string;
}

export interface GuidanceCheckResult {
  outcome: 'available' | 'none';
  candidates: LessonWithTrace[];
}
```

- [ ] **Step 4: Implement bounded shortlist retrieval**

Add to `LessonService`:

```ts
async checkGuidance(context: GuidanceContext): Promise<GuidanceCheckResult> {
  const query = [
    context.task,
    context.artifact_type,
    context.stage,
    context.workspace,
    context.relevant_excerpt,
  ].filter((value): value is string => Boolean(value?.trim())).join(' ');
  const candidates = await this.db.lessons.list({
    status: 'promoted',
    q: query,
    limit: 5,
  });
  return { outcome: candidates.length > 0 ? 'available' : 'none', candidates };
}
```

Do not persist `GuidanceContext`.

- [ ] **Step 5: Write failing MCP prompt and skill contract tests**

Extend `backend/test/mcpGuidance.test.ts`:

```ts
expect(descriptions.get('check_guidance')).toContain('search similarity alone');
expect(descriptions.get('check_guidance')).toContain('one sentence explaining why');

const prompt = buildCheckGuidancePrompt({
  task: 'Prepare a final project update',
  stage: 'before sending',
});
expect(prompt).toContain('same kind of decision');
expect(prompt).toContain('remain silent');
expect(prompt).toContain('one sentence');
```

Extend `backend/test/birdieMentorSkill.test.ts`:

```ts
expect(skill).toContain('At task start');
expect(skill).toContain('Before a consequential final action');
expect(skill).toContain('search similarity is only a shortlist');
expect(skill).toContain('remain silent');
```

- [ ] **Step 6: Run the contextual guidance contract tests and confirm they fail**

Run:

```bash
bun test backend/test/mcpGuidance.test.ts backend/test/birdieMentorSkill.test.ts
```

Expected: FAIL because the contextual route, tool, prompt, and skill behavior do not exist.

- [ ] **Step 7: Add the REST endpoint and MCP tool**

In `backend/src/routes/lessons.ts`, register before `/:id`:

```ts
const guidanceContextBody = z.object({
  task: z.string().trim().min(2),
  artifact_type: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  workspace: z.string().trim().min(1).optional(),
  relevant_excerpt: z.string().trim().min(1).optional(),
});

router.post('/check-guidance', requireScope('birdie:read'), async (req, res) => {
  const parsed = guidanceContextBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  res.json(await ctx.lessonService.checkGuidance(parsed.data));
});
```

Register `check_guidance` in `backend/src/mcp/tools.ts` with the same schema. Its description must state that returned candidates are not automatically relevant and that the connected LLM must show at most two only after a direct, explainable match.

- [ ] **Step 8: Add the high-confidence prompt and proactive skill behavior**

Export `buildCheckGuidancePrompt(context: GuidanceContext)` from `backend/src/mcp/prompts.ts` with this decision contract:

```text
1. Call check_guidance with the bounded current context.
2. Treat search similarity only as a shortlist.
3. Show a lesson only if it addresses the same kind of decision or mistake, is actionable now, and no context makes it inapplicable.
4. If showing guidance, return at most two three-part lessons and one sentence explaining why each applies.
5. If no candidate passes every check, remain silent and continue the user's primary work.
```

Register a `check-guidance` MCP prompt. Update `skills/birdie-mentor/SKILL.md` so proactive retrieval happens at task start, before a consequential final action, after a correction, and on explicit request. Preserve the existing rule that Birdie unavailability never blocks the primary work.

- [ ] **Step 9: Run focused tests**

Run:

```bash
bun test backend/test/services.test.ts backend/test/mcpGuidance.test.ts backend/test/birdieMentorSkill.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add backend/src/types.ts backend/src/services/lessonService.ts backend/src/routes/lessons.ts backend/src/mcp/tools.ts backend/src/mcp/prompts.ts skills/birdie-mentor/SKILL.md backend/test/services.test.ts backend/test/mcpGuidance.test.ts backend/test/birdieMentorSkill.test.ts
git commit -m "feat: check guidance in current work"
```

---

### Task 3: Duplicate suggestions and evidence merging

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/db.ts`
- Modify: `backend/src/adapters/types.ts`
- Modify: `backend/src/adapters/sqlite/dbAdapter.ts`
- Modify: `backend/src/adapters/postgres/dbAdapter.ts`
- Modify: `backend/src/repositories/lessonRepository.ts`
- Modify: `backend/src/services/lessonService.ts`
- Modify: `backend/src/routes/lessons.ts`
- Modify: `backend/src/mcp/tools.ts`
- Test: `backend/test/db.test.ts`
- Test: `backend/test/services.test.ts`
- Test: `backend/test/postgresDbAdapter.test.ts`
- Test: `backend/test/mcpGuidance.test.ts`

**Interfaces:**
- Produces: `Lesson.merged_into_lesson_id: string | null` as system metadata.
- Produces: `LessonStore.merge(sourceId, targetId, reviewer): Promise<LessonWithTrace>`.
- Produces: `LessonService.findSimilar(id, limit)` and `LessonService.merge(sourceId, targetId, reviewer)`.
- Produces: `GET /lessons/:id/similar` and `POST /lessons/:id/merge`.
- Guarantees: source evidence remains stored; merged candidates never appear as promoted guidance.

- [ ] **Step 1: Write failing service tests for merging**

Add this exact case to the existing `services` describe block in `backend/test/services.test.ts`:

```ts
it('merges a pending correction into existing guidance without changing its three fields', async () => {
  const existingTrace = await traceService.capture({
    submitted_by: 'Alex',
    before_text: 'Send it soon.',
    after_text: 'Send it by Friday.',
  });
  const existingDraft = await traceService.extract({
    trace_id: existingTrace.id,
    quote: 'soon',
    what_changed: 'Use a concrete deadline.',
    why_it_matters: 'Concrete deadlines make follow-up clear.',
  });
  const existing = await lessonService.promote(existingDraft.id, { reviewer: 'Morgan' });

  const duplicateTrace = await traceService.capture({
    submitted_by: 'Sam',
    before_text: 'I will reply later.',
    after_text: 'I will reply by Tuesday at noon.',
  });
  const duplicate = await traceService.extract({
    trace_id: duplicateTrace.id,
    quote: 'later',
    what_changed: 'State the exact response deadline.',
    why_it_matters: 'Concrete deadlines make follow-up clear.',
  });
  const original = {
    quote: existing.quote,
    what_changed: existing.what_changed,
    why_it_matters: existing.why_it_matters,
  };

  const merged = await lessonService.merge(duplicate.id, existing.id, {
    reviewer: 'Taylor',
    reviewer_user_id: null,
  });

  expect(merged.status).toBe('rejected');
  expect(merged.merged_into_lesson_id).toBe(existing.id);
  expect(await lessonService.get(existing.id)).toMatchObject(original);
  expect(await traceService.get(duplicate.trace_id)).toBeDefined();
});

it('rejects an invalid merge target', async () => {
  const trace = await traceService.capture({
    submitted_by: 'Alex',
    before_text: 'Send it soon.',
    after_text: 'Send it by Friday.',
  });
  const lesson = await traceService.extract({
    trace_id: trace.id,
    quote: 'soon',
    what_changed: 'Use a concrete deadline.',
    why_it_matters: 'Concrete deadlines make follow-up clear.',
  });

  await expect(lessonService.merge(lesson.id, lesson.id, {
    reviewer: 'Morgan',
    reviewer_user_id: null,
  })).rejects.toThrow('cannot be merged into itself');
});
```

- [ ] **Step 2: Run adapter/service tests and confirm they fail**

Run:

```bash
bun test backend/test/services.test.ts
```

Expected: FAIL because merge metadata and operations do not exist.

- [ ] **Step 3: Add merge metadata to shared types and adapter contracts**

Add to `Lesson` in `backend/src/types.ts`:

```ts
merged_into_lesson_id: string | null;
```

Add to `backend/src/adapters/types.ts`:

```ts
export interface MergeLessonPayload {
  reviewer: string;
  reviewer_user_id?: string | null;
}

// on LessonStore
merge(sourceId: string, targetId: string, payload: MergeLessonPayload): Promise<LessonWithTrace>;
```

- [ ] **Step 4: Migrate SQLite and implement repository merging**

In `backend/src/db.ts`, add `merged_into_lesson_id` to new schemas and existing installs:

```sql
merged_into_lesson_id TEXT REFERENCES lessons(id)
```

```ts
addColumnIfMissing(db, 'lessons', 'merged_into_lesson_id', 'TEXT REFERENCES lessons(id)');
```

Extend the existing fresh-schema assertion in `backend/test/db.test.ts`:

```ts
expect(lessonColumns).toContain('merged_into_lesson_id');
```

In `LessonRepository.merge()` validate both lessons, then execute:

```sql
UPDATE lessons
SET status = 'rejected', merged_into_lesson_id = ?, reviewer = ?,
    reviewer_user_id = ?, reviewed_at = ?
WHERE id = ?
```

Remove the source from SQLite FTS after merging so it cannot be suggested repeatedly. Expose the method through `SQLiteLessonStore`.

- [ ] **Step 5: Migrate PostgreSQL and implement store merging**

In `PostgresDBAdapter.initialize()`, add:

```sql
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS merged_into_lesson_id text REFERENCES lessons(id);
```

Include the field in `LessonRow` mapping and `lessonSelect()`. Implement the same validation and update in `PostgresLessonStore.merge()`, then remove the source row from `lesson_search_vectors`.

Extend the existing PostgreSQL integration case in `backend/test/postgresDbAdapter.test.ts` after the first lesson is promoted:

```ts
const duplicateTrace = await db.traces.create({
  submitted_by: 'Sam',
  before_text: 'reply later',
  after_text: 'reply by Tuesday',
});
const duplicate = await db.lessons.create({
  trace_id: duplicateTrace.id,
  quote: 'later',
  quote_verified: true,
  what_changed: 'Use a concrete response deadline.',
  why_it_matters: 'Concrete deadlines make follow-up clear.',
});
const merged = await db.lessons.merge(duplicate.id, lesson.id, { reviewer: 'Taylor' });
expect(merged.merged_into_lesson_id).toBe(lesson.id);
expect(merged.status).toBe('rejected');
```

- [ ] **Step 6: Implement similarity and merge services**

Add to `LessonService`:

```ts
async findSimilar(id: string, limit = 5): Promise<LessonWithTrace[]> {
  const lesson = await this.get(id);
  if (!lesson) throw new Error(`Lesson not found: ${id}`);
  const matches = await this.db.lessons.list({
    q: `${lesson.what_changed} ${lesson.why_it_matters}`,
    limit: Math.min(Math.max(limit + 1, 2), 10),
  });
  return matches
    .filter((candidate) =>
      candidate.id !== id &&
      candidate.status !== 'rejected' &&
      !candidate.merged_into_lesson_id
    )
    .slice(0, limit);
}

merge(sourceId: string, targetId: string, reviewer: MergeLessonPayload): Promise<LessonWithTrace> {
  return this.db.transaction(async (session) => {
    const source = await this.requireLesson(session, sourceId);
    const target = await this.requireLesson(session, targetId);
    if (source.id === target.id) throw new Error('A lesson cannot be merged into itself');
    if (source.status !== 'pending_review') throw new Error('Only pending lessons can be merged');
    if (target.status === 'rejected') throw new Error('Cannot merge into rejected guidance');
    return session.lessons.merge(sourceId, targetId, reviewer);
  });
}
```

- [ ] **Step 7: Add failing MCP merge contract tests**

Extend `backend/test/mcpGuidance.test.ts`:

```ts
expect(descriptions.get('find_similar_lessons')).toContain('duplicate or conflict');
expect(descriptions.get('merge_lesson')).toContain('explicitly selects');
expect(descriptions.get('merge_lesson')).toContain('three fields remain unchanged');
```

Run `bun test backend/test/mcpGuidance.test.ts` and expect failure because the tools do not exist.

- [ ] **Step 8: Implement merge routes and MCP action**

In `backend/src/routes/lessons.ts`:

```ts
router.get('/:id/similar', requireScope('birdie:read'), async (req, res) => {
  res.json(await ctx.lessonService.findSimilar(req.params.id, 5));
});

router.post('/:id/merge', requireScope('birdie:write'), async (req, res) => {
  const parsed = z.object({ target_lesson_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  res.json(await ctx.lessonService.merge(req.params.id, parsed.data.target_lesson_id, {
    reviewer: req.user!.name,
    reviewer_user_id: req.user!.id,
  }));
});
```

Add MCP tools `find_similar_lessons` and `merge_lesson`. Their descriptions must require a human-selected merge target and state that the existing lesson's three fields remain unchanged.

- [ ] **Step 9: Run SQLite, PostgreSQL, route, and MCP tests**

Run:

```bash
bun test backend/test/db.test.ts backend/test/postgresDbAdapter.test.ts backend/test/services.test.ts backend/test/mcpGuidance.test.ts
```

Expected: PASS. PostgreSQL integration cases may remain skipped when `TEST_DATABASE_URL` is absent; compile coverage must still pass in Task 5.

- [ ] **Step 10: Commit Task 3**

```bash
git add backend/src/types.ts backend/src/db.ts backend/src/adapters/types.ts backend/src/adapters/sqlite/dbAdapter.ts backend/src/adapters/postgres/dbAdapter.ts backend/src/repositories/lessonRepository.ts backend/src/services/lessonService.ts backend/src/routes/lessons.ts backend/src/mcp/tools.ts backend/test/db.test.ts backend/test/services.test.ts backend/test/postgresDbAdapter.test.ts backend/test/mcpGuidance.test.ts
git commit -m "feat: merge repeated lesson evidence"
```

---

### Task 4: Three-part review and shared-guidance experience

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/ReviewList.tsx`
- Modify: `web/src/PromotedLessonCard.tsx`
- Modify: `web/src/KnowledgeBase.tsx`
- Modify: `web/src/CaptureForm.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `Lesson.merged_into_lesson_id`, `GET /lessons/:id/similar`, and `POST /lessons/:id/merge` from Task 3.
- Produces: exact three-part labels everywhere a lesson appears.
- Produces: editable review cards with explicit merge controls and no extra lesson fields.

- [ ] **Step 1: Update the web API types and methods**

In `web/src/api.ts`, add:

```ts
// on Lesson
merged_into_lesson_id: string | null;

export function findSimilarLessons(id: string): Promise<Lesson[]> {
  return get(`/lessons/${id}/similar`);
}

export function mergeLesson(id: string, targetLessonId: string): Promise<Lesson> {
  return post(`/lessons/${id}/merge`, { target_lesson_id: targetLessonId });
}
```

- [ ] **Step 2: Change every lesson surface to the approved labels**

In `ReviewList.tsx` and `PromotedLessonCard.tsx`, use exactly:

```text
What was initially wrong
What to do instead
Why it matters
```

Keep all three editable in `ReviewList`. Change the privacy reminder to profession-neutral copy:

```text
Remove private names, project details, and secrets before sharing.
```

Update `KnowledgeBase.tsx` search copy so it says that search covers the initial quote, the better approach, and why it matters.

- [ ] **Step 3: Add duplicate suggestions to pending review cards**

Create a small `SimilarLessons` child inside `ReviewList.tsx` that loads only for the currently edited card:

```tsx
function SimilarLessons({ lessonId, working, onMerge }: {
  lessonId: string;
  working: boolean;
  onMerge: (target: Lesson) => void;
}) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  useEffect(() => {
    findSimilarLessons(lessonId).then(setLessons).catch(() => setLessons([]));
  }, [lessonId]);
  if (lessons.length === 0) return null;
  return (
    <aside className="similar-lessons" aria-label="Similar guidance">
      <span>Possible duplicate or conflict</span>
      {lessons.map((lesson) => (
        <div key={lesson.id}>
          <p>{lesson.what_changed}</p>
          <Button type="button" variant="outline" size="sm" disabled={working}
            onClick={() => onMerge(lesson)}>
            Merge into this lesson
          </Button>
        </div>
      ))}
    </aside>
  );
}
```

Wire merging through the existing `act()` helper:

```tsx
async function handleMerge(source: Lesson, target: Lesson) {
  await act(source.id, async () => {
    await mergeLesson(source.id, target.id);
    setEditingId(null);
    setMessage('Correction evidence merged. The selected lesson wording was kept.');
  });
}
```

Render `SimilarLessons` only inside the active editor and pass `onMerge={(target) => handleMerge(lesson, target)}`.

- [ ] **Step 4: Keep manual capture honest**

Update `CaptureForm.tsx` copy so the current web form says it saves source evidence for lesson drafting rather than falsely claiming that a lesson is already in the review queue:

```text
Save the before and corrected work as source evidence. A connected Birdie agent can turn it into a pending lesson.
```

Do not add extra lesson fields to the manual evidence form.

- [ ] **Step 5: Build the web app**

Run:

```bash
bun run --cwd web build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 6: Commit Task 4**

```bash
git add web/src/api.ts web/src/ReviewList.tsx web/src/PromotedLessonCard.tsx web/src/KnowledgeBase.tsx web/src/CaptureForm.tsx web/src/styles.css
git commit -m "feat: simplify the three-part lesson review"
```

---

### Task 5: Public positioning and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/index.html`
- Modify: `skills/birdie-mentor/SKILL.md`
- Test: `backend/test/birdieMentorSkill.test.ts`

**Interfaces:**
- Consumes: the three outcome-oriented operations and approved labels from Tasks 1–4.
- Produces: public product language centered on “Stop giving the same correction twice.”
- Produces: a verified final feature slice across backend, web, and skill surfaces.

- [ ] **Step 1: Update README product positioning**

Replace the generic opening with:

```markdown
Birdie helps teams stop giving the same correction twice. It turns real before/after feedback into a simple, reviewed lesson:

1. What was initially wrong.
2. What to do instead.
3. Why it matters.

The connected work tool detects and drafts useful lessons. People review what becomes shared guidance, and Birdie brings approved lessons back when similar work appears. Everyone can contribute and everyone can learn; Birdie has no mentor/learner hierarchy.
```

Explain that MCP is one supported adapter to the hosted Birdie product, not the product's defining value.

- [ ] **Step 2: Align the static docs homepage**

Update `docs/index.html` hero and workflow copy to use:

```text
Stop giving the same correction twice.
Turn real feedback into reviewed guidance that appears when similar work returns.
```

Show the same three-part lesson labels and remove any profession-specific or hierarchy-dependent claims.

- [ ] **Step 3: Verify the skill names all three fields and non-hierarchical behavior**

Extend `backend/test/birdieMentorSkill.test.ts`:

```ts
expect(skill).toContain('What was initially wrong');
expect(skill).toContain('What to do instead');
expect(skill).toContain('Why it matters');
expect(skill).toContain('Everyone can contribute and everyone can learn');
```

Update `skills/birdie-mentor/SKILL.md` with one explicit statement—`Everyone can contribute and everyone can learn.`—and name the three fields exactly as asserted above. Do not add role gates.

- [ ] **Step 4: Run the focused skill test**

Run:

```bash
bun test backend/test/birdieMentorSkill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full backend tests**

Run:

```bash
bun run --cwd backend test
```

Expected: all tests pass; PostgreSQL-only tests may skip without `TEST_DATABASE_URL`.

- [ ] **Step 6: Run production builds**

Run:

```bash
bun run build
```

Expected: backend TypeScript compilation and web Vite production build both succeed.

- [ ] **Step 7: Check the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status lists only the intended Task 5 documentation/skill files before commit.

- [ ] **Step 8: Commit Task 5**

```bash
git add README.md docs/index.html skills/birdie-mentor/SKILL.md backend/test/birdieMentorSkill.test.ts
git commit -m "docs: position Birdie around repeated corrections"
```

- [ ] **Step 9: Verify the completed branch from a clean worktree**

Run:

```bash
git status --short
bun run --cwd backend test
bun run build
git diff --check d27a1d3..HEAD
```

Expected: clean status, passing backend suite, successful backend/web build, and no whitespace errors across the final change set.
