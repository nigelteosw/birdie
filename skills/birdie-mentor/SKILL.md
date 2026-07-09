---
name: birdie-mentor
description: Capture before/after edits as mentorship examples, extract lessons, and review them.
---

# Birdie Mentor

Birdie stores reviewed lessons from before/after edits. Use the `birdie` MCP tools directly.

## First Use

If Birdie says it is not set up, use the `setup-birdie` MCP prompt. Ask whether the user has a Birdie server URL. If yes, call `complete_setup` with `mode: "remote"` and the URL. Otherwise call `complete_setup` with `mode: "local"`.

Offer to customize categories. If the user wants that, ask what field they work in and what kinds of edits matter, then call `save_domain_profile` with a markdown profile containing `# Domain`, `# Typology`, and `# What counts as mentorship-worthy`.

## Workflow

1. Capture a before/after edit with `capture_trace`.
2. Extract a candidate lesson using the `extract-lesson` prompt, or manually call `get_trace` then `save_extraction` or `skip_extraction`.
3. Review with `list_lessons`, `review_lesson`, and `promote_lesson`.

Promoted lessons are also browsable by reviewers on the web review queue (My Lessons / Shared Pool tabs).

## Surfacing the review queue

Whenever `save_extraction`, `list_lessons`, or `review_lesson` leaves one or more lessons in `pending_review`, call `open_review_queue` yourself — no need to ask first, it's a local, no-argument, side-effect-free call — and include the returned URL in your reply, e.g. "2 lessons are pending review. Queue: http://127.0.0.1:4317". Don't wait for the user to ask for it.
