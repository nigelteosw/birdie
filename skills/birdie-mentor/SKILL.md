---
name: birdie-mentor
description: TRIGGER — capture proactively, without being asked, the moment someone corrects, edits, or improves another person's code, draft, or document anywhere in the conversation (a PR review, an inline fix to someone else's work, "here's how I'd rewrite what Lauren sent" — any before/after where one named person improved another's work). Also TRIGGER proactively whenever the user asks how a specific named person would approach, handle, or think about something ("how would Sarah tackle this", "what would Amir do here", "has anyone dealt with this before") — check the lesson pool before answering from general knowledge alone. Also use for first-time setup when Birdie says it isn't configured, for listing/reviewing/promoting pending lessons, and for browsing or searching the knowledge base of reviewed lessons.
---

# Birdie Mentor

Birdie stores reviewed lessons from before/after edits. Use the `birdie` MCP tools directly.

## First Use

If Birdie says it is not set up, use the `setup-birdie` MCP prompt. Ask whether the user has a Birdie server URL. If yes, call `complete_setup` with `mode: "remote"` and the URL. Otherwise call `complete_setup` with `mode: "local"`.

Also ask the user's own name and pass it as `user_name` on that same `complete_setup` call (or `update_birdie_settings` later). Birdie remembers it in `~/.birdie/config.json`, so you don't need to ask again in future conversations — read it back any time via `get_birdie_settings` and use it as the default `submitted_by` when the user is capturing their own edit, or to tell "the user" apart from a named person they're asking about in `ask_lesson`.

Offer to customize the domain profile. If the user wants that, ask what field they work in and what kinds of edits matter, then call `save_domain_profile` with a markdown profile containing `# Domain` and `# What counts as mentorship-worthy`. In shared-server mode this updates the team's server profile for every connected assistant; in local mode it only updates that user's local profile. If the domain profile still reads like the generic default (a legal-practice template), that's a sign no one has customized it yet — flag it and offer to fix it instead of assuming it fits.

## Proactive Capture

Don't wait to be asked and don't wait for the user to say "capture this." The moment you notice one person's edit correcting or improving another person's code, draft, or document — in this conversation, in a diff you're shown, in a PR you're reviewing — call `capture_trace`:

- `before_text` / `after_text`: the original and the corrected content, verbatim (not summarized or truncated).
- `submitted_by`: the name of the person whose edit this is (e.g. "Nigel reviewing Lauren's draft" → `submitted_by: "Nigel"`). If it genuinely isn't clear from context, ask once, briefly — then remember the answer for the rest of the conversation instead of asking again.
- `context_note`: one line on what prompted the edit, if it isn't obvious from the before/after text alone.

Skip pure typo fixes, whitespace/formatting-only changes, and edits with no identifiable reasoning behind them — check the domain profile's "What counts as mentorship-worthy" section for the team's actual bar, since it varies by domain.

Capturing is cheap and reversible (it just writes a local row); a human still has to review and promote before anything is used to answer questions, so err on the side of capturing rather than silently skipping something that might matter.

## Proactive Retrieval

Capture isn't the only proactive trigger — retrieval is the other half, and it's just as easy to forget to ask for. Don't wait for the user to say "check Birdie." Call `ask_lesson` unprompted whenever:

- The user names a specific person and asks how they'd approach, handle, or think about something ("how would Sarah tackle an uncapped indemnity clause", "what would Amir say about this").
- The user is about to start something that resembles a previously captured example (similar file, similar kind of change, similar problem) and a quick check could surface relevant prior guidance.

Pass the user's question as `question`, the named person (if any) as `person`, and fold the returned lesson cards into your answer — synthesize from what comes back, and say plainly if nothing relevant was found rather than inventing an answer. Birdie returns at most 12 keyword matches (ranked when SQLite FTS is available), so keep the question specific when possible. This is the same division of labor as extraction: Birdie returns grounded data, you do the reasoning. If the user asks about themselves ("how did I handle this last time"), use the remembered `user_name` (see First Use) as `person`.

## Workflow

1. Capture a before/after edit with `capture_trace` (see Proactive Capture above — do this unprompted).
2. Extract a candidate lesson using the `extract-lesson` prompt, or manually call `get_trace` then `save_extraction` or `skip_extraction`.
3. Review with `list_lessons`, `review_lesson`, and `promote_lesson`.
4. Ask the pool with `ask_lesson` (or the `ask-lesson` prompt) — see Proactive Retrieval above — do this unprompted too.

Promoted lessons are also browsable by reviewers on the web review queue (My Lessons / Knowledge Base tabs).

## Settings

When the user asks to inspect setup, switch between local and shared-server mode, connect multiple assistants, troubleshoot the backend, change the domain profile, or update their remembered name, use the `configure-birdie` prompt. For direct tool use, call `get_birdie_settings`, `update_birdie_settings` (accepts `user_name` on its own, no `mode` required), `get_domain_profile`, `save_domain_profile`, or `birdie_doctor`.

## Surfacing the review queue

Whenever `save_extraction`, `list_lessons`, or `review_lesson` leaves one or more lessons in `pending_review`, call `open_review_queue` yourself — no need to ask first, it's a local, no-argument, side-effect-free call — and include the returned URL in your reply, e.g. "2 lessons are pending review. Queue: http://127.0.0.1:6677". Don't wait for the user to ask for it.
