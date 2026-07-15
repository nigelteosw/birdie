---
name: birdie-mentor
description: Use when a conversation contains a clearly reusable before/after correction to code, drafts, or documents, regardless of whether anyone is named; when the user asks to capture or review a Birdie lesson; or when current work could benefit from promoted Birdie guidance, especially questions about how a person or team handled similar work.
---

# Birdie Mentor

Birdie turns real corrections into reviewed team guidance. Use the connected `birdie` MCP tools directly.

## First use

If the tools are unavailable, tell the user to connect their team's `https://<host>/mcp`. Do not pretend anything was saved. If the domain profile is generic, offer to customize it with `save_domain_profile`.

## Capture threshold

Capture proactively when the original and corrected content are both visible, the correction has identifiable reasoning, and that reason can guide similar future work. Names are optional; the signed-in account supplies attribution. Capture a qualifying correction even when nobody is named; lack of names is never a reason to skip.

Skip typo-only, formatting-only, purely subjective, one-off, or unsafe-to-store edits. Never invent missing before/after text. Use the domain profile as the team's bar.

When an edit does not qualify, continue the user's primary task without mentioning Birdie unless the user asked about capture.

## Automatic capture and extraction

For every qualifying correction, complete this sequence in the same turn:

1. Call `capture_trace` with verbatim `before_text` and `after_text`. Add `context_note` only when needed to explain the correction.
2. From the returned trace, use `before_text` verbatim as the exact quote when it is already one concise statement; otherwise choose the smallest exact contiguous excerpt from before_text that preserves the lesson. Never quote `after_text` or paraphrase.
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
