# Birdie — Mentorship Capture Plugin: Design

Status: Approved for planning
Date: 2026-07-08
Owner: Nigel Teo

---

## 1. Problem Statement

Junior lawyers learn the most from the moment a senior redlines their work — but that moment is lossy. The senior makes an edit, maybe leaves a one-line comment, and the *reasoning* behind the change (is this a playbook rule? a stylistic preference? a real legal risk call?) lives only in the senior's head. It doesn't get captured, it doesn't get reused, and the next junior who makes the same mistake gets the same one-line comment instead of the underlying lesson.

This project is inspired by two pieces of prior work in `LexCatalyst`:

- **Birdie mentor** (`docs/features/birdie-mentor.md`) — a floating AI mentor juniors can ask questions without judgment.
- **Structured Review Handoff RFC** (`docs/rfc-review-handoff.md`, superseded in that project) — extracts `{original_clause, proposed_revision, reasoning, citations}` from a senior's review and promotes approved findings into a shared Knowledge Bank, gated by human approval.

Birdie (this repo) is a standalone, minimal version of the second idea, reframed around mentorship rather than document review: capture a **trace** (a before/after edit), let a connected AI assistant guess the **quote / what changed / why it matters**, have the senior **confirm or correct** the guess, and only then **promote** it into a reviewed pool that two different audiences can query. Birdie itself is an **MCP server** — it holds no LLM of its own; the reasoning is done by whatever model is on the other end of the MCP connection (Claude Code, Claude Desktop, Codex CLI, or any other MCP-compatible host).

This is a post-hackathon scaffold. The goal is a working end-to-end loop, not a polished product.

---

## 2. Goals

- Capture a before/after edit pair as a **trace**, tagged with who submitted it and their role (`senior` | `junior`), plus which senior and which junior the situation involves.
- Let the connected AI assistant extract a candidate **lesson** from a trace: the quoted text that changed, a summary of the change, a guessed reason it matters, and a guessed **typology** (what kind of change this is).
- If a firm playbook excerpt is supplied, flag whether the edit **aligns with or diverges from** the playbook, and say so outright when it diverges.
- Make the taxonomy and "what's worth capturing" judgment **editable per domain**: Birdie isn't law-specific. A single markdown file (§6.1) lets each team — law, audit, tax, software, anything — define their own typology categories and mentorship-worthy criteria without touching code. Not every trace should become a lesson; the assistant can decide to skip one.
- Require a senior to **review and confirm** (or edit, or reject) every AI guess before it becomes a lesson.
- Split promoted lessons by audience: **juniors can ask how a senior (or seniors in general) handled a similar issue**; **seniors can ask what a specific junior (or juniors in general) are struggling with**. Only promoted (reviewed) lessons feed either query — review is mandatory for both audiences, not a single undifferentiated "shared library."
- Support **bring-your-own-model** natively, not via provider config: Birdie is an MCP server with zero LLM API calls and zero model credentials. Whatever model is already running the connected client does the reasoning when it calls Birdie's tools. Swapping models means swapping which MCP host you're using, not reconfiguring Birdie.
- **Local-first for v1**: a single person or small team runs Birdie on their own machine (or one shared internal box) against a single SQLite file. Storage sits behind a small repository interface so a later Postgres-backed "deployed shared service" is a new implementation of that interface, not a rewrite — but that deployment story is explicitly future, not v1 (§3).
- Let the user choose how to run it at startup — MCP server only, web UI only, or both — rather than forcing one shape (§4.1).
- Keep "data" and "judgment" as two separate, independently-inspectable layers: MCP **tools** hold no opinions (§8.2), MCP **prompts** hold the taxonomy/methodology and work with any host (§9.1), and a Claude Code **Skill** is a thin, optional wrapper over both — not a third place logic can drift into.

## 3. Non-goals (explicit out of scope for v1)

- Upload Portal, DMS connectors, Outlook/Slack/Discord/Telegram ingestion. The data model and API are shaped so these can be added later as adapters (`traces.source`), but none are built now.
- Authentication, RBAC, or multi-tenant organizations. Single trusted instance; `submitted_by` / `reviewer` / `junior_name` / `senior_name` are free-text names, not accounts.
- Document/PDF parsing or track-changes extraction. v1 only accepts pasted/uploaded plain before/after text.
- A general-purpose chat mentor with its own conversational loop or persona (that's what LexCatalyst's Birdie already does). This tool has no chat UI of its own — it's a set of MCP tools; the conversational experience comes from whichever MCP host (Claude Code, Claude Desktop, Codex CLI, etc.) the user is already chatting with.
- Multi-round versioning of a single trace, multi-reviewer workflows.
- An automated redaction/PII pipeline. v1 relies on the calling assistant following instructions to strip identifying details before promotion, plus the mandatory human reviewer — not a dedicated scanning service. See §7.2.
- A Postgres (or other) storage backend, or a deployed multi-user shared service. The repository interface makes both possible later; v1 is local-only, single SQLite file.

---

## 4. Architecture

Birdie has one core service (trace/lesson storage + business rules: quote verification, playbook-alignment bookkeeping, role-filtered queries) exposed through two thin transports:

- **MCP server** (primary) — tools for capture, extraction, review, promotion, and the two ask queries. Used by chatting with any MCP-capable client (Claude Code, Claude Desktop, Codex CLI, etc.) that has Birdie registered as a plugin. This is the "AI" in "AI plugin": Birdie itself calls no LLM — the connected host's model reads tool output and reasons about it, then calls a `save_*` tool to persist its answer.
- **REST API + minimal web UI** (secondary) — pure data operations only: capture a trace, browse/edit the review queue. No AI reasoning happens over REST, because there's no MCP host on the other end to supply a model. One page, two parts (§4.2) — not a multi-screen app.

```
Capture (before/after text pair, role, junior/senior names)
      │                                              ┌─ via REST (data only)
      ▼                                              └─ via MCP tool `capture_trace`
Extract ── the connected MCP host's model reads the trace (tool: `get_trace`)
      │    and calls `save_extraction` with quote/what_changed/why_it_matters/typology/playbook_alignment
      ▼
Review queue (senior confirms / edits / rejects) ── mandatory gate, via web UI or MCP tools
      │
      ▼
Promote ──► queryable by two audiences over the same reviewed pool:
      ├─ `ask_senior_approach`   (junior-facing, optional senior_name filter)
      └─ `ask_junior_struggles`  (senior-facing, optional junior_name filter)
```

Single Node/TypeScript codebase. SQLite storage via `better-sqlite3`, accessed through a small repository interface (`TraceRepository`, `LessonRepository`) so a future Postgres (or other) backing store is a new implementation of that interface, not a rewrite. No message queue, no background workers — everything is synchronous request/response.

### 4.1 Run modes (local-first)

v1 is local-only — one person or one small team, one machine, one SQLite file. Both transports live in the same package and the user picks what to start, similar to how local memory-MCP setups (e.g. LangMem-style tooling) pair an MCP server with a companion web dashboard for managing what's stored:

```
npx birdie mcp     # MCP server only (stdio) — register in Claude Code / Claude Desktop / Codex CLI
npx birdie web      # REST + web UI only — capture/review/library in a browser
npx birdie          # both, sharing the same SQLite file at DB_PATH
```

Both modes read/write the same `DB_PATH` file, so a lesson captured via chat (MCP) shows up immediately in the browser Review queue, and a lesson reviewed in the browser is immediately visible to the next `ask_*` call in chat. "Deployed as a small shared service" (§2) — multiple people pointed at one non-local database — is a later extension of the same repository interface, not part of this build.

### 4.2 Web UI: one page, two parts

The web UI is a single page, not a multi-screen app — no routing, no tabs. Two parts stacked on one screen:

1. **Capture** — a compact form at the top: before/after text, submitted-by name/role, junior/senior names, optional playbook ref/text. Submitting posts to `POST /traces` and clears the form.
2. **Review** — everything below it: the list of `pending_review` lessons, each rendered as the lesson card (§7.1) with editable fields, a typology field, a playbook-divergence banner when it applies, and Confirm & Promote / Reject actions. This is the answer to "things to review, to decide if they should be admitted as a lesson" — the one job this page does.

There is no separate browsable "Library" screen in v1. Promoted lessons are queryable — via `GET /lessons?status=promoted` over REST, or the `ask_*` MCP tools in chat (§7.4) — but the web UI itself only shows what still needs a decision. Keeps the UI to exactly the two things a reviewer actually does at their desk: add a trace, clear the queue.

### Repo layout

```
birdie/
├─ backend/
│  ├─ src/
│  │  ├─ server.ts            Express app (REST, data-only), route mounting
│  │  ├─ mcp/
│  │  │  ├─ server.ts         fastmcp server entrypoint (stdio transport)
│  │  │  ├─ tools.ts          tool definitions — data layer (§8.2)
│  │  │  └─ prompts.ts        prompt templates — judgment layer (§8.3, §9.1)
│  │  ├─ db.ts                better-sqlite3 connection + schema migration
│  │  ├─ repositories/
│  │  │  ├─ traceRepository.ts
│  │  │  └─ lessonRepository.ts
│  │  ├─ routes/
│  │  │  ├─ traces.ts
│  │  │  └─ lessons.ts
│  │  ├─ extraction.ts        quote verification, playbook-alignment bookkeeping (pure logic, no LLM calls)
│  │  └─ types.ts
│  ├─ test/                   unit tests (quote verification, save_extraction validation)
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ .env.example
├─ web/
│  ├─ src/
│  │  ├─ CaptureForm.tsx       part 1 of the single page (§4.2)
│  │  ├─ ReviewList.tsx        part 2 of the single page (§4.2)
│  │  ├─ api.ts
│  │  └─ App.tsx                renders CaptureForm + ReviewList, no routing
│  ├─ package.json
│  └─ vite.config.ts
├─ skills/
│  └─ birdie-mentor/
│     └─ SKILL.md              thin Claude Code wrapper over the MCP tools/prompts (§9.1) — optional, not required for functionality
├─ domain.md                    editable domain profile (§6.1) — ships with a legal example, meant to be replaced per-firm
├─ docs/
│  └─ superpowers/specs/
├─ package.json                npm workspaces root (dev script runs REST+web; separate script runs the MCP server)
└─ README.md
```

---

## 5. Data Model

**`traces`** — one row per captured before/after pair.

```
id                  (uuid, pk)
submitted_by        (text)              free-text name, no auth
submitted_by_role   (text)              'senior' | 'junior' — role of whoever captured this trace
junior_name         (text, nullable)    whose draft/situation this concerns
senior_name         (text, nullable)    whose correction/technique this reflects
before_text         (text)
after_text          (text)
playbook_ref        (text, nullable)    e.g. "NDA §4.3"
playbook_text       (text, nullable)    pasted excerpt used for divergence check
context_note        (text, nullable)    free-text context from the submitter
source              (text)              'manual' | 'upload' | 'api', default 'manual'
status              (text)              'captured' | 'extracted' | 'skipped'
skip_reason         (text, nullable)    set when status='skipped' (§6.1)
created_at          (timestamp)
```

`junior_name` and `senior_name` are both nullable, but at least one should be set for a trace to be useful — a trace with neither set will never surface in either ask query (§7.4). The common case (a senior redlines a junior's draft) sets both from a single capture: it's simultaneously a signal of "how this senior handled it" and "what this junior needed help with."

**`lessons`** — the AI-generated (then senior-confirmed) learning point, one per trace (v1: 1:1, not 1:many).

```
id                  (uuid, pk)
trace_id            (fk -> traces.id)
quote               (text)              verbatim excerpt, must appear in before_text
quote_verified      (boolean)           substring-match result, computed in code
what_changed        (text)              assistant's summary of the diff
why_it_matters      (text)              assistant's reasoning guess
typology            (text)              free text, validated against the active domain profile's categories (§6.1) — not a fixed enum
playbook_alignment  (text, nullable)    'aligned' | 'diverges' | 'not_applicable'
playbook_note       (text, nullable)    assistant's explanation of alignment/divergence
status              (text)              'pending_review' | 'rejected' | 'promoted'
reviewer            (text, nullable)    free-text name
reviewed_at         (timestamp, nullable)
promoted_at         (timestamp, nullable)
created_at          (timestamp)
```

No separate `citations` table in v1 (unlike the LexCatalyst RFC) — `playbook_ref` / `playbook_note` cover the one citation type in scope. Can be generalized later if other citation kinds are needed.

---

## 6. Extraction Pipeline

There is no extraction service inside Birdie — no LLM API call, no provider config. Extraction happens when a user chats with their MCP-connected assistant and asks it to process a trace. The assistant:

1. Calls the `get_trace` tool to read `before_text`, `after_text`, and `playbook_text` (if any).
2. Judges whether this trace is actually **mentorship-worthy**, using the "what counts as mentorship-worthy" guidance from the domain profile (§6.1) — not every edit is a teachable moment; a typo fix or pure reformat isn't. If not, it calls `skip_extraction` with a short reason instead of forcing a lesson out of nothing.
3. If it is worth capturing, reasons about the diff itself — this is the assistant's own model doing the work, whichever one that is — using the domain profile's typology categories (§6.1).
4. Calls the `save_extraction` tool with its answer: `{ trace_id, quote, what_changed, why_it_matters, typology, playbook_alignment?, playbook_note? }`. The tool's input schema documents the required shape; `typology` is validated against whatever categories are currently listed in the domain profile, so any connected model is guided the same way regardless of which one it is.

### 6.1 Domain profile

Birdie isn't law-specific. What counts as a "playbook," what typology categories make sense, and what's even mentorship-worthy varies by field — a software team's code-review lessons look nothing like a tax practice's or an audit team's. Rather than hardcode a taxonomy, Birdie reads a **domain profile**: a single markdown file the firm or team edits themselves, no code changes required.

`DOMAIN_PROFILE_PATH` (default `./domain.md`) is a markdown file with three sections:

```markdown
# Domain
One paragraph describing the practice area, in plain language.

# Typology
- category_name: one-line definition
- category_name: one-line definition
...

# What counts as mentorship-worthy
Guidance for judging whether a given before/after edit reflects a
real judgment call worth capturing, versus noise (typos, pure
reformatting, etc.) that shouldn't become a lesson.
```

Its full text is injected verbatim as shared context into all three MCP prompts (§8.3) — not parsed into structured config, just read as prose, so editing it is as simple as editing a markdown file. Birdie ships with `domain.md` pre-filled using a legal example (matching this project's origin):

| `Typology` category | Definition |
|---|---|
| `playbook_compliance` | The edit enforces a documented firm playbook/style-guide rule. |
| `editorial_style` | A stylistic or formatting preference with no risk or playbook basis (word choice, tone, formatting). |
| `substantive_risk` | A legal risk or liability judgment call (e.g. changing indemnity caps, liability allocation). |
| `clarity_precision` | The edit resolves ambiguity or tightens vague drafting without changing the underlying legal position. |
| `other` | Doesn't fit the above — `why_it_matters` must explain what it is instead. |

A firm doing audit, tax, or software review replaces this file's content with their own categories and criteria — e.g. an engineering team might use `architecture`, `correctness`, `security`, `style` instead. `lessons.typology` is stored as free text, not a fixed database enum, precisely so this stays a config change, not a code change.

Birdie's own responsibility, whether or not extraction happens, is grounding, done in code, not delegated to the model:

- **Verify the quote** — on `save_extraction`, check `quote` is a substring of `before_text`. If it fails, persist anyway but set `quote_verified=false`, so the review UI surfaces "quote not verified" instead of silently trusting the AI. This is the concrete implementation of "AI should not just provide changes without senior source."
- Persist as a `lessons` row with `status='pending_review'`. Trace `status` flips to `'extracted'`.

**Failure modes:**
- The assistant judges the trace not mentorship-worthy → `skip_extraction` sets trace `status='skipped'` with the given reason. Visible (not silently dropped) in the review queue and Library as a skipped item, so the person who captured it sees why.
- The assistant declines for another reason or the call errors → nothing is persisted; the trace stays `status='captured'` and extraction can be requested again later.
- `save_extraction` is called with a `typology` value not present in the current domain profile, or missing required fields → rejected with a validation error, surfaced back to the assistant so it can retry with corrected values.
- Quote doesn't verify → lesson is still created (senior can still review and manually fix the quote), just flagged.

---

## 7. Review & Promotion

### 7.1 Lesson card format

Every lesson — in the Review queue, in the Library, and in `ask_*` results — is rendered as the same three-part card, in this fixed order:

1. **Quote** — the verbatim excerpt from `before_text` that changed.
2. **What changed** — a summary of the edit.
3. **Why it matters** — the reasoning for why the edit was made.

All three fields are generated by the connected assistant at extraction time (§6) and are exactly what a senior confirms or edits during review (§7.2). This triad is the atomic unit of the product — a trace produces one card, a card is what gets reviewed, and a card is what appears to either audience. No surface invents its own summary shape; Capture, Review, Library, and the `ask_*` tools all read/write the same `quote` / `what_changed` / `why_it_matters` fields on `lessons`.

### 7.2 Review queue

Review queue (`GET /lessons?status=pending_review` over REST, or the `list_lessons` / `review_lesson` MCP tools in chat) shows each lesson card (§7.1) with the AI's guesses editable inline:

- Quote, what changed, why it matters — free-text fields, pre-filled, editable.
- Typology — dropdown (web UI) or enum argument (MCP), pre-filled with the AI's guess, senior can override. This directly answers "ask senior to confirm a AI generated guess as to why the change is made" with a fixed typology.
- Playbook alignment — shown as a banner (web UI) or a flagged field (MCP). If `diverges`, rendered prominently (not just informational) — "This edit diverges from playbook `NDA §4.3`. Confirm this is intentional or note why." This is the "system should tell them outrightly they should follow it" requirement.
- Actions: **Confirm & Promote**, **Save as Draft** (stays `pending_review` with edits saved, decide later), **Reject** (sets `status='rejected'`, excluded from both audiences).

"Confirm & Promote" is a single call — `POST /lessons/:id/promote` (REST) or the `promote_lesson` tool (MCP) — accepting the (possibly edited) field values, so the caller doesn't need a separate save-then-promote round trip. "Save as Draft" leaves `status='pending_review'`. Promoting:

1. Applies any edited field values from the request.
2. The tool description (MCP) and the review form (web UI) both instruct the reviewer to strip obvious identifying details — client names, matter names — from `quote` / `why_it_matters` before promoting. This is the "privacy by design" step. There is no automated redaction pass in v1 — the mandatory human reviewer is the actual safety net, same as the review gate itself. Documented as a known limitation, not a guarantee.
3. Sets `status='promoted'`, `promoted_at=now`, `reviewer`, `reviewed_at`.
4. The lesson becomes queryable via the Library (§7.3) and the two `ask_*` tools (§7.4).

Promotion only accepts lessons with `status='pending_review'` (rejects `rejected` or already-`promoted` lessons) — nothing reaches either audience without going through this step, and it always requires a `reviewer` name. Enforced in code, not just convention.

### 7.3 Promoted lessons (queryable, not a web screen)

`GET /lessons?status=promoted` (REST) — the full reviewed pool. Each result carries the lesson card (§7.1) plus typology, playbook alignment, and the trace's `junior_name` / `senior_name`. Filterable by `typology`, `playbook_ref`, `junior_name`, `senior_name`. No full-text search in v1 beyond SQLite `LIKE` — enough for scaffold volumes, swap for FTS5 later if needed. This endpoint exists for the `ask_*` tools (§7.4) and for anyone who wants to query it directly; the web UI (§4.2) doesn't add a browsing screen for it — corrections happen by editing the underlying lesson before it's promoted, not after.

### 7.4 Ask: two audiences over the same promoted pool

Promotion (§7.2) puts a lesson into one reviewed pool, but it's queried differently depending on who's asking — this is the actual mentorship loop: juniors learn from how seniors handled things, seniors see where juniors need help.

**`ask_senior_approach`** (junior-facing MCP tool) — args `{ question: string, senior_name?: string }`. Looks up promoted lessons where `senior_name` matches (or all, if omitted), keyword-matched against `quote` / `what_changed` / `why_it_matters` / `playbook_ref` for relevance to `question` (plain SQLite `LIKE`, no embeddings — consistent with "lightweight"). Returns the matching lesson cards to the calling assistant, which synthesizes the actual answer ("Here's how Sarah handled an uncapped indemnity clause: ...") — Birdie supplies grounded source material, the connected model writes the answer, same division of labor as extraction (§6).

**`ask_junior_struggles`** (senior-facing MCP tool) — args `{ junior_name?: string }`. Returns promoted lessons where `junior_name` matches (or all juniors, grouped, if omitted), along with a `typology` × count breakdown, for the calling assistant to summarize ("Jane has 4 flagged edits this period, mostly substantive-risk calls on indemnity clauses"). Raw grouped counts are returned alongside the lesson cards so the assistant isn't required to re-derive them.

Both tools only query `lessons.status='promoted'` — the review gate (§7.2) applies equally to both audiences. Neither is mirrored over REST in v1: the synthesis step needs a model in the loop, which the REST/web-UI path doesn't have. Asking is an MCP-only, chat-driven interaction.

Naming a specific `junior_name` in `ask_junior_struggles` is a deliberate choice for this tool, unlike LexCatalyst's chat-based Birdie mentor (which is stateless specifically to protect junior psychological safety). This project is structured senior/junior feedback capture, not an anonymous chat mentor — a supervisor asking what their own junior needs help with is the intended use case, not surveillance of arbitrary juniors. Worth keeping in mind if this ever needs firm-wide RBAC (out of scope, §3).

---

## 8. API

### 8.1 REST (web UI — data operations only, no AI reasoning)

```
POST   /traces                    { before_text, after_text, submitted_by, submitted_by_role, junior_name?, senior_name?, playbook_ref?, playbook_text?, context_note? }
GET    /traces?status=            list, filterable by status — including 'skipped', so skipped traces are visible, not just dropped
GET    /traces/:id

GET    /lessons?status=           list, filterable by status / typology / playbook_ref / junior_name / senior_name
GET    /lessons/:id
PATCH  /lessons/:id               reviewer edits fields in place, or sets status='rejected'
POST   /lessons/:id/promote       apply edits + publish to the reviewed pool (requires reviewer name)
```

### 8.2 MCP tools (chat-driven, require a connected model)

```
capture_trace          same shape as POST /traces
get_trace               read a trace's before/after/playbook text, for the assistant to reason over
skip_extraction          { trace_id, reason } → sets trace status='skipped' when not mentorship-worthy (§6.1)
save_extraction          persist { trace_id, quote, what_changed, why_it_matters, typology, playbook_alignment?, playbook_note? } — quote-verified in code, typology validated against the domain profile (§6.1)
list_lessons             same as GET /lessons, for review-in-chat
review_lesson            same as PATCH /lessons/:id
promote_lesson            same as POST /lessons/:id/promote
ask_senior_approach       { question, senior_name? } → matching promoted lesson cards (§7.4)
ask_junior_struggles      { junior_name? } → promoted lesson cards + typology counts for that junior / all juniors (§7.4)
```

### 8.3 MCP prompts (the judgment layer, §9.1)

```
extract-lesson           given a trace_id: read it via get_trace, apply the domain profile's
                          mentorship-worthy criteria (skip_extraction if it doesn't qualify) and
                          typology categories (§6.1), verify the quote is verbatim, phrase playbook
                          divergence outright when it applies, then call save_extraction
ask-senior-approach       given a question (+ optional senior_name): call ask_senior_approach, then
                          synthesize an answer strictly from the returned lesson cards — no answer
                          if nothing relevant comes back, rather than inventing one
ask-junior-struggles      given an optional junior_name: call ask_junior_struggles, then summarize
                          the typology pattern with concrete examples from the returned cards
```

---

## 9. Model Access — no provider code in Birdie

Birdie makes zero LLM API calls and holds no model config, no API keys. This is the literal implementation of "bring your own model": whichever model is already running your MCP host — Claude in Claude Code or Claude Desktop, Codex in Codex CLI, GPT in any other MCP-compatible client — is the model that reasons over Birdie's data, because Birdie only ever hands that host structured data (`get_trace`, `ask_*` results) and accepts structured writes (`save_extraction`, `promote_lesson`). Swapping models means swapping which host you're chatting through; Birdie's code doesn't change.

Built with [`fastmcp`](https://github.com/punkpeye/fastmcp) (TypeScript) rather than the raw `@modelcontextprotocol/sdk` — it wraps the SDK with a simpler API for defining tools, prompts, and resources, and handles the stdio transport plumbing (§4.1's `birdie mcp` mode) that any Claude Code / Claude Desktop / Codex CLI MCP config expects. `fastmcp` treats **prompts** as a first-class primitive alongside tools, which is what §9.1 below builds on.

### 9.1 Two parts: tools vs. prompts

The MCP server has two genuinely distinct layers, built the same way `fastmcp` distinguishes them:

- **Tools** (`backend/src/mcp/tools.ts`) — the *data* layer: `capture_trace`, `get_trace`, `save_extraction`, `list_lessons`, `review_lesson`, `promote_lesson`, `ask_senior_approach`, `ask_junior_struggles`. No judgment, no taxonomy, no opinions — just typed reads and writes with the code-side grounding checks from §6/§7.2.
- **Prompts** (`backend/src/mcp/prompts.ts`) — the *judgment* layer: reusable prompt templates (`extract-lesson`, `ask-senior-approach`, `ask-junior-struggles`) that tell the connected model *how* to do the task well — the typology taxonomy (§6.1), how to phrase a playbook-divergence warning, how to synthesize an `ask_*` answer without inventing lessons that weren't returned. Prompts are protocol-native MCP, so they work identically regardless of which host/model is connected — this is what actually carries "bring your own model," not just the tools existing.

A thin `skills/birdie-mentor/SKILL.md` sits on top for Claude Code users specifically: it points at the same tools and prompts with a bit of extra framing and a worked example, giving Claude Code's Skill-discovery UX a nicer entry point. It adds no logic of its own and isn't required — a Codex CLI or Claude Desktop user gets full functionality from the MCP prompts alone.

---

## 10. Configuration

```
DB_PATH=./data/birdie.db
DOMAIN_PROFILE_PATH=./domain.md   # edit this file to adapt Birdie to your field — no code change needed (§6.1)
PORT=4000                 # REST API / web UI only — the MCP server itself takes no network config, it speaks stdio to its host
```

Run mode is chosen at the command line (§4.1: `birdie mcp` / `birdie web` / `birdie`, all wired to the same `backend` package via a small CLI entrypoint). Registering the MCP mode in Claude Code / Claude Desktop / Codex CLI config points the host at that same command — no separate credentials to configure.

---

## 11. Error Handling

- All REST API errors return `{ error: string }` with an appropriate HTTP status; no raw stack traces to the client.
- All MCP tool errors return a structured tool error the calling assistant can see and react to (e.g. retry with corrected arguments).
- A trace is always saved on `capture_trace` / `POST /traces` regardless of what happens afterward — extraction only happens later, on request, via `save_extraction`, so there's nothing to fail at capture time.
- `save_extraction` validates its input (`typology` checked against the loaded domain profile's categories, §6.1; required fields enforced) and rejects bad calls rather than persisting malformed data.
- Missing or unparseable `domain.md` → falls back to the shipped default (legal) profile rather than failing startup; logged as a warning.
- Quote-verification failure is a data flag (`quote_verified=false`), never a hard error — the senior can still review and fix it manually.
- SQLite file is created on first run if missing; schema migration runs at startup (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## 12. Testing

Given this is a scaffold, testing is thin but real — focused on the two pieces of logic that can silently misbehave rather than broad coverage:

- **Quote verification** — substring match logic (`backend/test/extraction.test.ts`): exact match, whitespace/formatting differences, no match.
- **Domain profile parsing** — extracting the `# Typology` category list from `domain.md`'s markdown; missing-file fallback to the default profile.
- **`save_extraction` input validation** — rejects `typology` values not in the loaded profile's categories, and missing required fields.

No end-to-end or UI test suite in v1; manual verification of the capture → extract (via chat) → review → promote → ask loop before considering the scaffold done.

---

## 13. Build Order

1. Repo scaffold — npm workspaces root, `backend/` and `web/` packages, TypeScript config, SQLite schema + migration, repository interfaces (`TraceRepository`, `LessonRepository`), and the `birdie` CLI entrypoint (`mcp` / `web` / default-both subcommands, §4.1).
2. Core service layer — trace/lesson CRUD and quote verification over the repository interfaces (no transport yet).
3. MCP server (`fastmcp`) — `capture_trace`, `get_trace`, `skip_extraction`, `save_extraction`, `list_lessons`, `review_lesson`, `promote_lesson` tools, wired to the core service. This is the demo-critical path: capture → extract-by-chat → review-by-chat → promote.
4. `ask_senior_approach` + `ask_junior_struggles` MCP tools.
5. Domain profile loader (`domain.md` parsing for the `# Typology` category list, used by `save_extraction` validation) + MCP prompts (`extract-lesson`, `ask-senior-approach`, `ask-junior-struggles`) that inject the profile as context (§6.1, §8.3, §9.1).
6. REST API mirroring the data-only operations (`traces`, `lessons` routes) for the web UI.
7. Web UI: one page, `CaptureForm` + `ReviewList` (§4.2), wired to the REST API.
8. `skills/birdie-mentor/SKILL.md` — thin Claude Code wrapper over the same tools/prompts.
9. Unit tests for quote verification + `save_extraction` input validation.
10. README with setup/run instructions, including how to register Birdie as an MCP server in Claude Code / Claude Desktop / Codex CLI.

---

## References

- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/features/birdie-mentor.md` — mentor persona and framing this project borrows its name and spirit from.
- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/rfc-review-handoff.md` (superseded in that project) — the structured extraction/review/promotion pattern this design adapts.
- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/product-requirement.md` — original whiteboard notes on the mentorship pain points this addresses.
- [Model Context Protocol](https://modelcontextprotocol.io) — server/tool/prompt primitives this design builds on for "bring your own model."
- [`fastmcp`](https://github.com/punkpeye/fastmcp) — the TypeScript framework Birdie's MCP server is built with (§9).
- LangMem-style local memory MCP tooling — the reference point for pairing a local MCP server with a companion web dashboard over the same store (§4.1).
