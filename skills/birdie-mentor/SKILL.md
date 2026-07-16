---
name: birdie-mentor
description: Use when a conversation contains a clearly reusable before/after correction to code, drafts, or documents, regardless of whether anyone is named; when the user asks to capture or review a Birdie lesson; or when current work could benefit from promoted Birdie guidance, especially questions about how a person or team handled similar work.
---

# Birdie Mentor

Birdie turns real corrections into reviewed team guidance. Use the connected `birdie` MCP tools directly.
Everyone can contribute and everyone can learn; Birdie does not assign mentor or learner roles.

## First use

If the tools are unavailable, tell the user to connect their team's `https://<host>/mcp`. Do not pretend anything was saved. If the domain profile is generic, offer to customize it with `save_domain_profile`.

## Capture threshold

Capture proactively when the original and corrected content are both visible, the correction has identifiable reasoning, and that reason can guide similar future work. Names are optional; the signed-in account supplies attribution. Capture a qualifying correction even when nobody is named; lack of names is never a reason to skip.

Skip typo-only, formatting-only, purely subjective, one-off, or unsafe-to-store edits. Never invent missing before/after text. Use the domain profile as the team's bar.

When an edit does not qualify, continue the user's primary task without mentioning Birdie unless the user asked about capture.

## Automatic lesson capture

For every qualifying correction, complete this sequence in the same turn:

1. Keep `before_text` and `after_text` verbatim. Add `context_note` only when the correction is otherwise unclear.
2. Prepare the three editable lesson fields:
   - **What was initially wrong** (`quote`): use `before_text` verbatim when it is already concise; otherwise choose the smallest exact contiguous excerpt from before_text that preserves the lesson. Never quote `after_text` or paraphrase.
   - **What to do instead** (`what_changed`): state the corrected action plainly.
   - **Why it matters** (`why_it_matters`): explain the transferable significance, including a boundary only when needed to prevent misuse.
3. Create a stable unique `idempotency_key` for this correction event, then call `capture_correction` once with that key, the evidence, and all three fields. Reuse the same key if the call must be retried; never generate a new key for a retry.
4. Inspect the result. It must remain `pending_review` and return `quote_verified: true`.
5. If `quote_verified` is false, call `review_lesson` with a corrected exact quote from `before_text`. If it still fails, leave it pending and report the verification problem.
6. On success, say one short sentence: `Saved a pending Birdie lesson: <what_changed>. It still needs review.`

If capture fails, report it and stop; never invent a trace ID or claim anything was saved.

## Human review boundary

Never call `promote_lesson` without explicit user approval of that lesson. Before promotion, remove private names, project details, secrets, and unsafe content. Use `review_lesson` when the user asks to edit, defer, or reject a candidate. Call `open_review_queue` only when the user asks to review lessons or open the queue.

## Proactive retrieval

Check guidance at deliberate moments:

- **At task start**, call `check_guidance` with a bounded description of the task when promoted guidance could materially affect the work.
- **Before a consequential final action**, such as sending, submitting, or requesting review, check again when the work has become more specific.
- **After a correction**, run the capture workflow above and let review handle possible duplication.
- **On explicit request**, call `ask_lesson` or `check_guidance` as appropriate.

Returned search similarity is only a shortlist. Surface at most two lessons only when they address the same kind of decision or mistake, are actionable now, and no visible context makes them inapplicable. Include one sentence explaining why each lesson applies. If no candidate passes every check, remain silent and continue the user's primary work.

Send only context already available to the connected agent: task, artifact type, stage, workspace, and the minimum relevant excerpt. If Birdie is unavailable, continue the primary work without blocking it.
