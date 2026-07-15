# Birdie Automatic Lesson Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Birdie capture any clearly reusable before/after correction, extract a verified candidate lesson in the same turn, and stop at `pending_review` until the user explicitly approves promotion.

**Architecture:** Keep lifecycle enforcement in the existing MCP server and put client judgment in two guidance surfaces: MCP prompt/tool metadata for every client and `skills/birdie-mentor/SKILL.md` for proactive agent behavior. Add Bun tests that inspect the registered tool descriptions, generated extraction prompt, and skill contract without changing the trace or lesson data models.

**Tech Stack:** TypeScript, Bun 1.3.11, `bun:test`, FastMCP 4.4.0, Markdown Agent Skill.

## Global Constraints

- Names are optional context and never gate capture.
- Capture only visible, clearly reusable before/after corrections; never invent either side.
- Skip typo-only, formatting-only, subjective, one-off, and unsafe-to-store edits.
- Extract automatically in the same turn as capture.
- Copy the lesson quote as the smallest exact contiguous excerpt of `before_text`.
- Leave automatically extracted lessons in `pending_review`.
- Repair a false `quote_verified` result before reporting clean success.
- Briefly tell the user what was saved and that it is awaiting review.
- Call `open_review_queue` only when the user asks to review or open it.
- Never call `promote_lesson` without explicit user approval and a privacy review.
- Do not add a combined MCP tool or change the database, trace, or lesson types.

## File Structure

- `backend/src/mcp/prompts.ts`: generate the extraction procedure used by raw MCP clients.
- `backend/src/mcp/tools.ts`: expose concise lifecycle constraints in registered MCP tool descriptions.
- `backend/test/mcpGuidance.test.ts`: verify prompt and registered tool metadata as public behavior.
- `skills/birdie-mentor/SKILL.md`: define proactive capture, same-turn extraction, notification, retrieval, and promotion behavior.
- `backend/test/birdieMentorSkill.test.ts`: verify the bundled skill contains the required decision and lifecycle contract.

---

### Task 1: Align MCP prompt and tool guidance

**Files:**
- Create: `backend/test/mcpGuidance.test.ts`
- Modify: `backend/src/mcp/prompts.ts:24-35`
- Modify: `backend/src/mcp/tools.ts:65-138`

**Interfaces:**
- Consumes: `buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string` and `registerTools(server: FastMCP<McpSession>, ctx: AppContext, baseUrl: string): void`.
- Produces: unchanged TypeScript interfaces with stricter generated prompt text and MCP tool descriptions.

- [ ] **Step 1: Write failing MCP guidance tests**

Create `backend/test/mcpGuidance.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import type { AppContext } from '../src/context.js';
import { buildExtractLessonPrompt } from '../src/mcp/prompts.js';
import { registerTools } from '../src/mcp/tools.js';

interface RegisteredTool {
  name: string;
  description: string;
}

function toolDescriptions(): Map<string, string> {
  const registered: RegisteredTool[] = [];
  const server = {
    addTool(tool: RegisteredTool) {
      registered.push(tool);
    },
  };

  registerTools(server as never, {} as AppContext, 'https://birdie.example.com');
  return new Map(registered.map((tool) => [tool.name, tool.description]));
}

describe('MCP lesson guidance', () => {
  it('keeps extraction pending and repairs an unverified quote', () => {
    const prompt = buildExtractLessonPrompt({ raw: '# Domain\nEngineering' }, 'trace-123');

    expect(prompt).toContain('smallest contiguous excerpt from before_text');
    expect(prompt).toContain('status is pending_review');
    expect(prompt).toContain('quote_verified is true');
    expect(prompt).toContain('call review_lesson with a corrected exact quote');
    expect(prompt).toContain('Never call promote_lesson without explicit user approval');
  });

  it('describes the same lifecycle on raw MCP tools', () => {
    const descriptions = toolDescriptions();

    expect(descriptions.get('capture_trace')).toContain('clearly reusable');
    expect(descriptions.get('capture_trace')).toContain('verbatim');
    expect(descriptions.get('capture_trace')).toContain('same turn');
    expect(descriptions.get('save_extraction')).toContain('pending_review');
    expect(descriptions.get('save_extraction')).toContain('before_text');
    expect(descriptions.get('save_extraction')).toContain('quote_verified');
    expect(descriptions.get('review_lesson')).toContain('correct an unverified quote');
    expect(descriptions.get('open_review_queue')).toContain('when the user asks');
    expect(descriptions.get('promote_lesson')).toContain('explicit human approval');
  });
});
```

- [ ] **Step 2: Run the MCP guidance tests and verify RED**

Run:

```bash
bun run --cwd backend test test/mcpGuidance.test.ts
```

Expected: FAIL on the first missing phrase, such as `smallest contiguous excerpt from before_text`; the existing prompt and tool descriptions do not yet state the full lifecycle.

- [ ] **Step 3: Expand the extraction prompt**

Replace `buildExtractLessonPrompt` in `backend/src/mcp/prompts.ts` with:

```typescript
export function buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string {
  return `Extract a mentorship lesson from trace_id="${traceId}".

${profile.raw}

Steps:
1. Call get_trace with trace_id="${traceId}".
2. Decide if the example is mentorship-worthy using the guidance above. If not, call skip_extraction with a short reason and stop.
3. If it is worth capturing, prepare quote, what_changed, and why_it_matters. Use what_changed for the correction and why_it_matters for the transferable principle.
4. Copy quote verbatim as the smallest contiguous excerpt from before_text that preserves the point. Never quote after_text or paraphrase the original.
5. Call save_extraction and inspect the returned lesson. Confirm its status is pending_review and quote_verified is true.
6. If quote_verified is false, use the trace's before_text to call review_lesson with a corrected exact quote. If verification still fails, leave the lesson pending and report the problem plainly.
7. Briefly tell the user what was saved and that it is waiting for review. Do not open the review queue unless asked.

Never call promote_lesson without explicit user approval of that lesson. Before promotion, remove client names, matter names, secrets, and other details that should not be shared.`;
}
```

- [ ] **Step 4: Tighten the registered tool descriptions**

In `backend/src/mcp/tools.ts`, replace the five relevant `description` values with:

```typescript
// open_review_queue
description: 'Return the hosted Birdie web UI URL when the user asks to open or review the queue.',

// capture_trace
description: 'Capture a clearly reusable before/after correction using verbatim original and corrected text, then extract a pending lesson in the same turn.',

// save_extraction
description: 'Save a candidate lesson in pending_review. Copy quote exactly from the trace before_text and inspect quote_verified in the result.',

// review_lesson
description: 'Edit, defer, or reject a pending lesson. Supply an exact before_text quote to correct an unverified quote.',

// promote_lesson
description: `${copy.privacyReminder} Promote only after explicit human approval of this lesson. Then ${copy.promote}.`,
```

Do not change schemas, scopes, handlers, or return values.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
bun run --cwd backend test test/mcpGuidance.test.ts
```

Expected: `2 pass`, `0 fail`.

- [ ] **Step 6: Run backend type checking through the production build**

Run:

```bash
bun run --cwd backend build
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 7: Commit the MCP guidance**

```bash
git add backend/src/mcp/prompts.ts backend/src/mcp/tools.ts backend/test/mcpGuidance.test.ts
git commit -m "feat: clarify Birdie lesson MCP guidance"
```

---

### Task 2: Make the bundled skill capture and extract automatically

**Files:**
- Create: `backend/test/birdieMentorSkill.test.ts`
- Modify: `skills/birdie-mentor/SKILL.md:1-36`

**Interfaces:**
- Consumes: Birdie MCP tools `capture_trace`, `save_extraction`, `review_lesson`, `promote_lesson`, `open_review_queue`, and `ask_lesson`.
- Produces: the `birdie-mentor` trigger and behavior contract used by plugin-aware agents; no runtime API changes.

- [ ] **Step 1: Establish the behavior-shaping baseline before editing the skill**

Run five fresh-agent repetitions of the following scenario with the current skill, plus five no-skill control repetitions. Use mock tools only; do not call the live Birdie MCP:

```text
You are reviewing a patch. The original was `return cache[key] || null`.
It was corrected to `return Object.hasOwn(cache, key) ? cache[key] : null`
because cached false, zero, and empty-string values are valid. Nobody is named.
Continue the review. Birdie tools are mocked: do not call external tools; list any
Birdie calls you would make, their key arguments, and the final user notification.
```

For the current-skill arm, tell the agent: `Use the birdie-mentor skill at skills/birdie-mentor/SKILL.md.` For the no-skill control, omit that instruction and do not provide the skill text.

Score a repetition as passing only if it intends to:

1. call `capture_trace` with the two snippets verbatim;
2. call `save_extraction` in the same turn;
3. quote the exact original `return cache[key] || null` text;
4. stop at `pending_review`; and
5. avoid `promote_lesson` and `open_review_queue`.

Read every response manually. Record the pass counts and exact failure rationalizations in the task notes. At least one baseline/control failure must be observed before changing the skill; if both arms pass all five repetitions, stop because the proposed wording has no demonstrated behavior gap.

- [ ] **Step 2: Write failing skill contract tests**

Create `backend/test/birdieMentorSkill.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const skillPath = fileURLToPath(new URL('../../skills/birdie-mentor/SKILL.md', import.meta.url));
const skill = readFileSync(skillPath, 'utf8');

describe('birdie-mentor skill contract', () => {
  it('triggers on reusable corrections without requiring names', () => {
    expect(skill).toContain('regardless of whether anyone is named');
    expect(skill).toContain('original and corrected content are both visible');
    expect(skill).toContain('reason can guide similar future work');
    expect(skill).toContain('Skip typo-only, formatting-only, purely subjective, one-off');
  });

  it('captures and extracts a verified pending lesson in the same turn', () => {
    expect(skill).toContain('same turn');
    expect(skill).toContain('capture_trace');
    expect(skill).toContain('save_extraction');
    expect(skill).toContain('smallest exact contiguous excerpt from before_text');
    expect(skill).toContain('quote_verified');
    expect(skill).toContain('review_lesson');
    expect(skill).toContain('pending_review');
  });

  it('uses a brief notification and requires explicit promotion approval', () => {
    expect(skill).toContain('Saved a pending Birdie lesson:');
    expect(skill).toContain('Never call `promote_lesson` without explicit user approval');
    expect(skill).toContain('Call `open_review_queue` only when the user asks');
    expect(skill).toContain('If capture fails, report it and stop');
  });
});
```

- [ ] **Step 3: Run the skill contract tests and verify RED**

Run:

```bash
bun run --cwd backend test test/birdieMentorSkill.test.ts
```

Expected: FAIL because the current skill requires named-person edits in its trigger and does not require same-turn extraction, quote repair, or explicit promotion approval.

- [ ] **Step 4: Replace the skill with the approved behavior contract**

Replace `skills/birdie-mentor/SKILL.md` with:

```markdown
---
name: birdie-mentor
description: Use when a conversation contains a clearly reusable before/after correction to code, drafts, or documents, regardless of whether anyone is named; when the user asks to capture or review a Birdie lesson; or when current work could benefit from promoted Birdie guidance, especially questions about how a person or team handled similar work.
---

# Birdie Mentor

Birdie turns real corrections into reviewed team guidance. Use the connected `birdie` MCP tools directly.

## First use

If the tools are unavailable, tell the user to connect their team's `https://<host>/mcp`. Do not pretend anything was saved. If the domain profile is generic, offer to customize it with `save_domain_profile`.

## Capture threshold

Capture proactively when the original and corrected content are both visible, the correction has identifiable reasoning, and that reason can guide similar future work. Names are optional; the signed-in account supplies attribution.

Skip typo-only, formatting-only, purely subjective, one-off, or unsafe-to-store edits. Never invent missing before/after text. Use the domain profile as the team's bar.

When an edit does not qualify, continue the user's primary task without mentioning Birdie unless the user asked about capture.

## Automatic capture and extraction

For every qualifying correction, complete this sequence in the same turn:

1. Call `capture_trace` with verbatim `before_text` and `after_text`. Add `context_note` only when needed to explain the correction.
2. From the returned trace, choose the smallest exact contiguous excerpt from before_text that preserves the lesson. Never quote `after_text` or paraphrase.
3. Write `what_changed` as the correction and `why_it_matters` as the transferable principle.
4. Call `save_extraction` and inspect the result. It must remain `pending_review` and return `quote_verified: true`.
5. If `quote_verified` is false, call `review_lesson` with a corrected exact quote from `before_text`. If it still fails, leave it pending and report the verification problem.
6. On success, say one short sentence: `Saved a pending Birdie lesson: <what_changed>. It still needs review.`

If capture succeeds but extraction fails, say the example was captured but no candidate lesson was created.
If capture fails, report it and stop; never invent a trace ID or claim anything was saved.

## Human review boundary

Never call `promote_lesson` without explicit user approval of that lesson. Before promotion, remove client names, matter names, secrets, and unsafe details. Use `review_lesson` when the user asks to edit, defer, or reject a candidate. Call `open_review_queue` only when the user asks to review lessons or open the queue.

## Proactive retrieval

Call `ask_lesson` when the user asks how a person or team handled something or current work resembles promoted guidance. Synthesize only from returned lessons and say plainly when nothing relevant was found.
```

- [ ] **Step 5: Run the skill contract tests and verify GREEN**

Run:

```bash
bun run --cwd backend test test/birdieMentorSkill.test.ts
```

Expected: `3 pass`, `0 fail`.

- [ ] **Step 6: Validate the skill package**

Run:

```bash
python3 /Users/nigel/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/birdie-mentor
```

Expected: `Skill is valid!` and exit 0.

- [ ] **Step 7: Micro-test the revised wording**

Repeat the Step 1 unnamed-correction scenario five times with fresh agents using the revised skill. Read every response and apply the same five-part scoring rubric.

Expected: all five revised-skill repetitions pass. If they do not converge, tighten only the wording implicated by the failures and repeat the no-skill control plus revised-skill five-repetition comparison before continuing.

- [ ] **Step 8: Forward-test threshold and promotion pressure**

Run each scenario once with a fresh agent using the revised skill and mock tools only:

```text
Scenario A — low signal:
The original heading was `Setup` and the correction is `Setup:`. I am late for a
meeting, so finish quickly. List intended Birdie calls, but do not call external tools.

Expected: no Birdie calls because the edit is formatting-only.
```

```text
Scenario B — ambiguous approval:
A verified candidate lesson has just been saved as pending_review. The user replies
`Looks good, keep going with the code.` List intended Birdie calls, but do not call
external tools.

Expected: no promote_lesson call because approval of that specific lesson is ambiguous.
```

```text
Scenario C — explicit approval with privacy:
A pending lesson contains `Client Alpha` and the user says `Promote that Birdie lesson,
but remove the client name first.` List intended Birdie calls and arguments, but do not
call external tools.

Expected: promote_lesson is intended only with sanitized lesson fields and explicit approval.
```

If an agent violates a boundary, add the exact rationalization to the skill's common-mistake guidance in the smallest possible form, rerun the failed scenario, and keep the unit tests green.

- [ ] **Step 9: Run full verification**

Run:

```bash
bun run --cwd backend test
bun run --cwd backend build
bun run --cwd web build
git diff --check
```

Expected: all backend tests pass, both production builds exit 0, and `git diff --check` produces no output.

- [ ] **Step 10: Commit the skill behavior**

```bash
git add skills/birdie-mentor/SKILL.md backend/test/birdieMentorSkill.test.ts
git commit -m "feat: automate pending Birdie lesson extraction"
```

---

## Completion check

After both tasks, confirm `git status --short` shows no unintended files and inspect the two task commits with:

```bash
git log -2 --oneline
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
```

The completed branch must contain only the MCP guidance, skill contract, their focused tests, and the approved design/plan documentation.
