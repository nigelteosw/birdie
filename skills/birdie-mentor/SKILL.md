---
name: birdie-mentor
description: TRIGGER — capture proactively, without being asked, the moment someone corrects, edits, or improves another person's code, draft, or document anywhere in the conversation (a PR review, an inline fix to someone else's work, "here's how I'd rewrite what Lauren sent" — any before/after where one named person improved another's work). Also TRIGGER proactively whenever the user asks how a specific named person would approach, handle, or think about something ("how would Sarah tackle this", "what would Amir do here", "has anyone dealt with this before") — check the lesson pool before answering from general knowledge alone.
---

# Birdie Mentor

Birdie stores reviewed lessons in the team's hosted service. Use the connected `birdie` MCP tools directly.

## First use

If the Birdie tools are unavailable, tell the user to add their team's `https://<host>/mcp` as a remote MCP server. The MCP client should open Birdie's sign-in and consent pages automatically. Do not offer local storage, a local MCP command, or remembered-name setup: identity comes from the authenticated Birdie account.

If the domain profile is still the generic default, offer to customize it. Ask what field the team works in and what edits matter, then call `save_domain_profile` with markdown containing `# Domain` and `# What counts as mentorship-worthy`.

## Proactive capture

Do not wait to be asked. When one person's edit improves another person's code, draft, or document, call `capture_trace` with:

- `before_text` and `after_text`: the original and corrected content verbatim.
- `context_note`: one line on what prompted the edit when the text alone is not enough.

Do not pass a person's name. Birdie attributes the capture to the signed-in account. Skip pure typos, formatting-only changes, and edits with no identifiable reasoning; use the domain profile as the team's actual bar.

## Proactive retrieval

Call `ask_lesson` unprompted when the user asks how a named person would approach something or starts work resembling a previously captured example. Pass the question and, when relevant, the named person. Synthesize only from returned lesson cards and say plainly when nothing relevant was found.

## Workflow

1. Capture the example with `capture_trace`.
2. Use the `extract-lesson` prompt, or `get_trace` followed by `save_extraction` or `skip_extraction`.
3. Review with `list_lessons`, `review_lesson`, and `promote_lesson`. Birdie attributes promotion to the signed-in account.
4. Query promoted guidance with `ask_lesson` or the `ask-lesson` prompt.

When work remains in `pending_review`, call `open_review_queue` and include the hosted URL in your reply.
