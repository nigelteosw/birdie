# Birdie Automatic Lesson Extraction Design

## Context

Birdie currently tells an MCP client to capture before/after edits proactively, but it leaves important decisions implicit:

- whether a person's name is required before capturing;
- whether extraction should happen immediately or in a later turn;
- what makes an edit reusable enough to become a lesson;
- which side of the edit supplies the verified quote; and
- whether the assistant may promote a candidate without human approval.

These gaps make client behavior inconsistent. They also make it easy to save an unverified quote from `after_text`, even though Birdie verifies lesson quotes against `before_text`.

## Goal

Give MCP-connected assistants one clear default workflow:

1. Recognize any clearly reusable before/after correction without requiring named participants.
2. Capture the original and corrected text verbatim.
3. Extract a candidate lesson automatically in the same turn.
4. Leave the lesson in `pending_review` and briefly report what was saved.
5. Promote only after explicit user approval.

## Non-goals

- Add a combined capture-and-extract MCP tool.
- Change the lesson, trace, or review data model.
- Auto-promote lessons.
- Capture every edit or conversation change.
- Require a name, role, or relationship for the people involved.
- Automatically open the review queue after every capture.

## Capture threshold

Capture only when all of the following are visible in the conversation or supplied material:

- there is identifiable original content and corrected content;
- the correction improves the original for a reason that can be stated plainly; and
- that reason could help with similar future work.

Names are optional context, not a gate. Birdie attributes the capture to the authenticated account.

Do not capture:

- typo-only or formatting-only edits;
- purely subjective preferences with no transferable rationale;
- one-off substitutions whose reasoning cannot generalize;
- edits where either the original or corrected text would have to be invented; or
- changes that contain sensitive details which cannot safely be stored verbatim.

## Automatic workflow

When an edit meets the threshold, the assistant performs this sequence without asking for a second confirmation:

1. Call `capture_trace` with verbatim `before_text` and `after_text`. Add a short `context_note` only when the texts do not explain the correction.
2. Use the returned trace ID to prepare a candidate lesson in the same turn.
3. Copy `quote` exactly from `before_text`. The quote should be the smallest contiguous excerpt that preserves the point of the correction.
4. Write `what_changed` as a concise description of the correction.
5. Write `why_it_matters` as the transferable principle or consequence, not a restatement of the edit.
6. Call `save_extraction` and inspect the returned lesson.
7. Confirm that the status is `pending_review` and `quote_verified` is true.
8. Briefly tell the user what was saved and that it is waiting for review.

If `save_extraction` returns `quote_verified: false`, the assistant must fetch the trace if necessary, choose an exact excerpt from `before_text`, and call `review_lesson` with the corrected quote. It must not report a clean success until verification is true. If verification still fails, it should leave the lesson pending and report the problem plainly.

## Review and promotion boundary

Automatic extraction creates a candidate, not shared guidance.

- `review_lesson` may be used when the user asks to edit, defer, or reject a pending candidate.
- `promote_lesson` may be called only after the user explicitly approves that lesson for promotion.
- Approval must identify the lesson or be unambiguous in the immediately preceding context.
- The assistant must remove client names, matter names, secrets, and other unsafe details before promotion.
- `open_review_queue` is called only when the user asks to review lessons or open the queue, not after every automatic extraction.

## Retrieval behavior

Retrieval remains proactive. Call `ask_lesson` when:

- the user asks how a named person or the team previously handled something; or
- current work materially resembles a topic covered by promoted guidance.

Synthesize only from returned promoted lessons. Say plainly when Birdie finds nothing relevant.

## Guidance surfaces

The behavior must be consistent across two surfaces:

### `skills/birdie-mentor/SKILL.md`

Update the trigger description and body so the skill:

- triggers on any clearly reusable before/after correction, not only named-person edits;
- distinguishes the capture threshold from the extraction and promotion thresholds;
- requires same-turn extraction into `pending_review`;
- requires an exact quote from `before_text`;
- defines the verification-repair path;
- uses a short success notification; and
- prohibits promotion without explicit approval.

### MCP prompts and tool descriptions

Update `backend/src/mcp/prompts.ts` and relevant descriptions in `backend/src/mcp/tools.ts` so clients without the bundled skill still receive the critical contract:

- `capture_trace` is for reusable, verbatim before/after corrections;
- `save_extraction` creates a pending candidate and requires a quote from `before_text`;
- `review_lesson` edits, defers, or rejects a candidate;
- `promote_lesson` requires explicit human approval and privacy review; and
- the extraction prompt performs capture assessment, exact quoting, verification inspection, and repair guidance.

The MCP server continues to enforce authentication, scopes, quote verification, and lifecycle state. The client skill and prompt supply the judgment needed to decide when to use those operations.

## Error handling

- If Birdie tools are unavailable, explain that the MCP connection is required and do not pretend a lesson was saved.
- If capture fails, report the failure and do not attempt extraction with an invented trace ID.
- If extraction fails after capture succeeds, report that the example was captured but no candidate lesson was created.
- If quote repair fails, leave the candidate in `pending_review`, disclose that verification failed, and never promote it automatically.
- If the edit does not meet the capture threshold, continue the user's primary task without mentioning Birdie unless the user asked about lesson capture.

## Verification strategy

Add focused tests before changing behavior:

- a reusable unnamed before/after correction triggers capture and same-turn extraction;
- a typo-only or preference-only edit does not trigger capture;
- extraction guidance requires the quote to come from `before_text`;
- a false `quote_verified` result triggers correction rather than a success claim;
- automatic extraction stops at `pending_review`;
- promotion requires explicit approval; and
- tool descriptions communicate the same lifecycle to non-skill MCP clients.

Forward-test the revised skill against realistic conversation examples after the focused repository tests pass. The evaluation should check tool choice, argument fidelity, notification shape, and resistance to auto-promotion.

## Acceptance criteria

- Named participants are no longer required for proactive capture.
- Every proactively captured reusable edit is extracted in the same turn unless a tool call fails.
- Candidate lessons use a verified verbatim quote from `before_text`.
- Successful automatic extraction leaves the lesson in `pending_review`.
- The user receives a brief confirmation identifying the saved learning point and pending status.
- No skill, prompt, or tool description authorizes automatic promotion.
- Skill-aware and raw MCP clients receive compatible guidance.
