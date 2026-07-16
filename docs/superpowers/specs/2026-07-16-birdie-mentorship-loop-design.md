# Birdie Mentorship Loop Design

**Date:** 2026-07-16
**Status:** Approved for specification

## Summary

Birdie helps teams stop giving the same correction twice. It detects meaningful corrections made during real work, drafts a simple lesson, asks a person to review it, and brings the approved guidance back when someone faces a similar situation.

Birdie is not organized around fixed mentor and learner roles. Everyone can contribute corrections and everyone can learn from the resulting guidance. The authority comes from reviewed evidence, not hierarchy.

The product remains deliberately small. Every lesson has exactly three editable content fields:

1. **What was initially wrong** — a quote grounded in the original work.
2. **What to do instead** — the corrected approach.
3. **Why it matters** — an LLM-drafted explanation of the transferable significance.

MCP is one capture and delivery adapter. Birdie's product is the full correction-to-guidance loop, not the protocol or a CRUD interface over lesson records.

## Problem

Useful working judgment is usually trapped in individual history: edits, review comments, chat feedback, and repeated explanations. Capturing that judgment in a wiki or training system creates additional work, so experienced teammates repeatedly give the same corrections while other teammates struggle to find relevant direction.

Existing tools preserve only fragments of the process:

- Review tools retain comments but do not turn them into reusable guidance.
- Wikis and learning systems require someone to author material separately from the work.
- Generic AI memory lacks verified source evidence and a human approval boundary.
- Searchable knowledge bases require the user to know that relevant guidance exists and to look for it.

Birdie makes mentorship a by-product of reviewing real work. A correction made today should help another teammate avoid the same mistake tomorrow.

## Product Positioning

The primary promise is:

> Stop giving the same correction twice.

Supporting explanation:

> Birdie turns real feedback from teammates into reviewed guidance that appears when someone faces a similar problem.

This positioning is profession-agnostic. The repeatable workflow is the product boundary:

```text
work -> correction -> lesson draft -> human review -> timely guidance
```

Domain profiles may describe what counts as valuable judgment for a particular team, but Birdie's lesson format and workflow do not change by profession.

## Design Principles

### No hierarchy

Birdie does not assign permanent mentor, senior, learner, or junior identities. A person may contribute expertise in one situation and receive guidance in another. Attribution records who contributed and reviewed an item without granting the lesson authority based on title.

### Real corrections are the source

Birdie captures only when genuine original and corrected work are available. It does not invent either side, and it ignores typo-only, formatting-only, purely subjective, unsafe-to-store, and non-transferable changes.

### Three fields are enough

The five questions used during review do not become five content fields:

| Review question | Where it is answered |
| --- | --- |
| What happened in the original work? | What was initially wrong |
| What is the correct approach? | What to do instead |
| What principle does this demonstrate? | Why it matters |
| When does it apply or not apply? | Included naturally in the corrected approach or significance when relevant |
| Does it duplicate or conflict with existing guidance? | Shown beside the lesson during review, not stored as another content field |

### Human-reviewed sharing

The LLM proposes; a person decides what becomes shared guidance. Automatic capture may create a pending lesson, but it must never promote one without explicit human approval.

### Quiet contextual delivery

Retrieval is not permission to interrupt. Birdie surfaces guidance only when it directly applies to the current decision and the connected agent can explain why. Uncertain matches remain silent.

### Work must continue without Birdie

Birdie is guidance, not a gate. An unavailable server, integration, or match service must never block drafting, editing, submission, or review.

## Lesson and Evidence Model

### Correction event

A correction event preserves the private source evidence:

- original work;
- corrected work;
- an optional context note;
- source and attribution metadata; and
- capture status.

The full correction event is available during review but is not copied wholesale into shared guidance.

### Lesson

A lesson contains exactly three user-editable content fields:

```text
What was initially wrong
What to do instead
Why it matters
```

The first field is an exact excerpt from the original work. A user may edit it by choosing a better excerpt, but Birdie rechecks that it remains grounded in the correction event. An unverified quote may remain pending but cannot be promoted.

The second field describes the correct action or approach. It does not have to reproduce the entire corrected artifact.

The third field is drafted by the connected LLM and explains why the correction is significant beyond the single example. It may include an important boundary or exception when that is necessary to prevent misuse.

Status, attribution, reviewer, timestamps, and source links are system metadata rather than additional lesson content.

### Evidence relationships

One correction initially produces one pending lesson. During review, a likely duplicate can be merged into an existing lesson. The existing lesson keeps its three fields while the new correction becomes additional supporting evidence. This allows repeated real corrections to strengthen one piece of guidance without filling the library with duplicate cards.

## End-to-End Experience

### 1. Notice a correction

When a connected agent sees a meaningful before/after correction, it captures both sides verbatim. Names are not required for capture; signed-in attribution is recorded automatically.

If the edit does not contain a transferable reason, the agent continues the user's work without creating or announcing a lesson.

### 2. Draft the lesson

In the same interaction, the connected LLM drafts the three fields. The initial quote must come from the original work. The lesson remains pending review.

### 3. Review the lesson

The review surface shows the editable three-part lesson beside its source evidence. It may also show similar pending or promoted guidance so the reviewer can spot a duplicate or a conflicting correction without adding fields to the lesson.

The reviewer can:

- edit any of the three fields;
- promote the lesson;
- reject it;
- merge its evidence into an existing lesson; or
- keep it separate when the distinction matters.

Review is permission-based, not title-based. There are no mentor or learner account types.

### 4. Check current work

At deliberate moments, the connected agent sends Birdie a bounded description of the work it is already handling. A context check may contain:

- the current task or intent;
- artifact or work type;
- stage of work;
- workspace or project identifier; and
- a relevant excerpt when needed.

Context checks are ephemeral by default and are not stored as correction evidence.

### 5. Deliver relevant guidance

Birdie retrieves a small shortlist of promoted lessons across all three fields. The connected LLM applies the relevance test defined below. A direct match is shown as the three-part card plus one sentence explaining why it applies now.

Low-confidence candidates remain silent. Users do not need to dismiss a stream of weak recommendations.

## Confidence and Triggering

High confidence is an eligibility decision, not an arbitrary percentage generated by an LLM. Search similarity only creates a shortlist.

A lesson may be surfaced when all of the following are true:

1. It is promoted, quote-verified, and available to the signed-in user.
2. The present task involves the same kind of decision, mistake, or desired action.
3. The guidance is actionable at the current stage of work.
4. The connected LLM can state a specific match reason using the current context and the lesson.
5. No visible evidence clearly makes the lesson inapplicable.

Birdie checks for guidance at four moments:

- at the start of a task, without interrupting merely because candidates exist;
- before a consequential final action, such as submitting, sending, or requesting review;
- after an explicit correction, when it should consider capture and possible duplication; and
- when the user directly asks for prior team guidance.

The delivery result is intentionally small:

- **show now:** return one or two directly applicable lessons with match reasons;
- **available:** candidates exist, but the client keeps them passive; or
- **none:** do not interrupt.

The MVP uses the LLM already present in the connected work tool. Birdie does not require its own hosted model provider.

## Product Architecture

```text
Connected work tool
  -> capture adapter
  -> correction evidence and three-part lesson draft
  -> review and duplicate check
  -> promoted guidance
  -> context check and retrieval
  -> connected LLM relevance decision
  -> timely delivery or silence
```

The architecture has five clear responsibilities:

1. **Capture adapters** accept real before/after corrections from MCP, APIs, or future integrations.
2. **Lesson service** validates evidence, manages the pending, promoted, and rejected lifecycle, and associates additional correction evidence during a merge.
3. **Review surface** edits all three fields and presents source evidence plus likely duplicates.
4. **Retrieval service** shortlists promoted lessons relevant to bounded task context.
5. **Delivery adapters** apply the relevance rubric and surface an explained match in the work tool.

The external product contract should emphasize three outcomes:

- `capture_correction` — preserve evidence and produce a pending three-part lesson;
- `review_lesson` — edit, reject, merge, or explicitly promote a lesson; and
- `check_guidance` — find guidance for current work and return only justified candidates.

REST routes and repository operations may remain internally, but users and connected agents should not experience Birdie as a collection of database commands. MCP is one implementation of these outcome-oriented actions.

## Privacy and Access

- The full correction is access-controlled evidence.
- Shared guidance contains only the minimum evidence required to make the lesson trustworthy.
- The review flow reminds users to remove names, client details, project details, secrets, and other unsafe content before promotion.
- Context checks are ephemeral unless the user separately captures a correction.
- The MVP uses the authenticated Birdie deployment as the shared team boundary. Multi-organization tenancy and complex nested scopes are outside this design.
- Birdie requests a relevant excerpt rather than an entire document whenever possible.

## Failure Behavior

- If either side of a correction is missing, do not invent it or create a trace.
- If capture fails, do not draft against an invented identifier.
- If lesson drafting fails after capture, preserve the correction for later extraction and report the partial result.
- If the initial quote does not match the original work, keep the lesson pending and block promotion until corrected.
- If a likely duplicate is found, suggest a merge but do not merge automatically.
- If retrieved guidance conflicts, do not surface either lesson automatically; show the conflict during review instead.
- If relevance is uncertain, remain silent.
- If Birdie is unavailable, continue the user's primary work normally.
- If a retry follows a partial failure, use idempotency to avoid duplicate corrections and lessons.

## MVP Scope

### Included

- proactive capture of meaningful before/after corrections;
- same-interaction drafting of the three-part pending lesson;
- editing all three lesson fields;
- quote verification and human-controlled promotion;
- duplicate or conflict suggestions and evidence merging;
- searchable shared guidance;
- context checks at deliberate work stages;
- explained, high-confidence delivery through the connected agent; and
- authenticated access through the current hosted Birdie deployment.

### Not included

- mentor, learner, senior, or junior account roles;
- profession-specific lesson schemas;
- additional applicability, exception, category, confidence, or outcome fields on the lesson card;
- dashboards or scoring systems;
- automatic promotion or automatic merging;
- a Birdie-owned model provider;
- broad document, source-control, or workplace integration suites;
- multi-organization tenancy; or
- blocking enforcement of guidance.

## Verification Strategy

Focused tests should cover the behavior that makes Birdie more than CRUD:

### Capture and drafting

- a reusable before/after correction produces one pending lesson;
- a typo-only or non-transferable edit does not create a lesson;
- the first field is copied exactly from the original work;
- the LLM drafts the corrected approach and significance; and
- a partial capture/extraction failure is reported without inventing state.

### Review

- all three fields can be edited;
- editing the initial quote re-runs source verification;
- an unverified quote cannot be promoted;
- promotion requires explicit human approval;
- a duplicate can be merged while preserving both correction events; and
- no behavior depends on mentor or learner account roles.

### Contextual delivery

- a clearly related task produces the promoted lesson and a specific match reason;
- an unrelated task produces no interruption;
- pending, rejected, unverified, or inaccessible lessons—and candidates whose evidence was merged into another lesson—are never surfaced;
- task-start and pre-final checks use bounded context; and
- an unavailable Birdie service does not block the primary work.

### Existing guarantees

- authenticated REST and MCP access remain protected;
- SQLite and PostgreSQL adapters preserve the same lesson lifecycle behavior;
- the web review and shared-guidance surfaces render the same three-part lesson; and
- backend and web builds continue to pass.

## Acceptance Criteria

- Birdie's public promise is “Stop giving the same correction twice.”
- The product has no mentor/learner hierarchy.
- Every lesson exposes exactly three editable content fields.
- The initial quote is grounded in real source evidence.
- Nothing becomes shared guidance without explicit human approval.
- Review answers the five agreed questions through the three fields and surrounding evidence, not through schema expansion.
- Connected agents check for guidance at deliberate moments rather than waiting only for manual search.
- Guidance appears only with a direct, explainable match to current work.
- Duplicate corrections can reinforce an existing lesson without creating duplicate cards.
- MCP is treated as one adapter to the mentorship loop, not as the product itself.
- Birdie failures never block the user's primary work.

## Product Success Signal

The primary product test is qualitative and concrete:

> A correction captured today helps someone avoid the same mistake tomorrow.

Early operational signals are the number of reviewed lessons reused in related work, the rate of irrelevant guidance, and the number of repeated corrections linked to existing lessons. The MVP does not require a dashboard for these signals.
