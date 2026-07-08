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

Birdie (this repo) is a standalone, minimal version of the second idea, reframed around mentorship rather than document review: capture a **trace** (a before/after edit), let an LLM guess the **quote / what changed / why it matters**, have the senior **confirm or correct** the guess, and only then **promote** it into a shared lessons library.

This is a post-hackathon scaffold. The goal is a working end-to-end loop, not a polished product.

---

## 2. Goals

- Capture a before/after edit pair as a **trace**.
- Use an LLM to extract a candidate **lesson**: the quoted text that changed, a summary of the change, a guessed reason it matters, and a guessed **typology** (what kind of change this is).
- If a firm playbook excerpt is supplied, flag whether the edit **aligns with or diverges from** the playbook, and say so outright when it diverges.
- Require a senior to **review and confirm** (or edit, or reject) every AI guess before it becomes a lesson.
- Only **promoted** (senior-confirmed) lessons are visible in the shared library — nothing reaches other users un-reviewed.
- Support **bring-your-own-model**: the LLM provider is swappable via config, not hardcoded.
- Keep the backend lightweight enough to run locally (single SQLite file) or be deployed as a small shared service.

## 3. Non-goals (explicit out of scope for v1)

- Upload Portal, DMS connectors, Outlook/Slack/Discord/Telegram ingestion. The data model and API are shaped so these can be added later as adapters (`traces.source`), but none are built now.
- Authentication, RBAC, or multi-tenant organizations. Single trusted instance; `submitted_by` / `reviewer` are free-text names, not accounts.
- Document/PDF parsing or track-changes extraction. v1 only accepts pasted/uploaded plain before/after text.
- A general-purpose chat mentor (that's what LexCatalyst's Birdie already does). This tool is a capture/review/library workflow, not a chatbot.
- Multi-round versioning of a single trace, multi-reviewer workflows.
- A full PII/anonymization pipeline. v1 does one lightweight LLM-based redaction pass at promotion time, not a dedicated scanning service.

---

## 4. Architecture

```
Capture (before/after text pair)
      │
      ▼
Extract (LLM) ──► quote + what_changed + why_it_matters + typology + playbook_alignment
      │
      ▼
Review queue (senior confirms / edits / rejects) ── mandatory gate
      │
      ▼
Promote (redact) ──► shared Lessons Library
```

Single Express (Node/TypeScript) backend, SQLite storage via `better-sqlite3`, minimal React (Vite + TypeScript) frontend with three screens. No message queue, no background workers — extraction runs synchronously on request (acceptable for v1 volume and for a single-LLM-call workload).

### Repo layout

```
birdie/
├─ backend/
│  ├─ src/
│  │  ├─ server.ts            Express app, route mounting
│  │  ├─ db.ts                better-sqlite3 connection + schema migration
│  │  ├─ routes/
│  │  │  ├─ traces.ts
│  │  │  └─ lessons.ts
│  │  ├─ llm/
│  │  │  ├─ provider.ts       LLMProvider interface
│  │  │  ├─ anthropic.ts      default provider
│  │  │  └─ openaiCompatible.ts
│  │  ├─ extraction.ts        prompt building, provider call, quote verification, playbook alignment
│  │  └─ types.ts
│  ├─ test/                   unit tests (quote verification, extraction parsing)
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ .env.example
├─ web/
│  ├─ src/
│  │  ├─ pages/
│  │  │  ├─ Capture.tsx
│  │  │  ├─ Review.tsx
│  │  │  └─ Library.tsx
│  │  ├─ api.ts
│  │  └─ App.tsx
│  ├─ package.json
│  └─ vite.config.ts
├─ docs/
│  └─ superpowers/specs/
├─ package.json                npm workspaces root (dev script runs both)
└─ README.md
```

---

## 5. Data Model

**`traces`** — one row per captured before/after pair.

```
id                  (uuid, pk)
submitted_by        (text)              free-text name, no auth
before_text         (text)
after_text          (text)
playbook_ref        (text, nullable)    e.g. "NDA §4.3"
playbook_text       (text, nullable)    pasted excerpt used for divergence check
context_note        (text, nullable)    free-text context from the submitter
source              (text)              'manual' | 'upload' | 'api', default 'manual'
status              (text)              'captured' | 'extracted'
created_at          (timestamp)
```

**`lessons`** — the AI-generated (then senior-confirmed) learning point, one per trace (v1: 1:1, not 1:many).

```
id                  (uuid, pk)
trace_id            (fk -> traces.id)
quote               (text)              verbatim excerpt, must appear in before_text
quote_verified      (boolean)           substring-match result, computed in code
what_changed        (text)              LLM summary of the diff
why_it_matters      (text)              LLM reasoning guess
typology            (text)              'playbook_compliance' | 'editorial_style' | 'substantive_risk' | 'clarity_precision' | 'other'
playbook_alignment  (text, nullable)    'aligned' | 'diverges' | 'not_applicable'
playbook_note       (text, nullable)    LLM explanation of alignment/divergence
status              (text)              'pending_review' | 'rejected' | 'promoted'
reviewer            (text, nullable)    free-text name
reviewed_at         (timestamp, nullable)
promoted_at         (timestamp, nullable)
created_at          (timestamp)
```

No separate `citations` table in v1 (unlike the LexCatalyst RFC) — `playbook_ref` / `playbook_note` cover the one citation type in scope. Can be generalized later if other citation kinds are needed.

---

## 6. Extraction Pipeline

Triggered either automatically on trace creation (`AUTO_EXTRACT=true`, default) or via explicit `POST /traces/:id/extract` (`AUTO_EXTRACT=false`).

1. Build a prompt from `before_text`, `after_text`, and (if present) `playbook_text`.
2. Call the configured `LLMProvider.extract()` requesting structured output: `{ quote, what_changed, why_it_matters, typology, playbook_alignment?, playbook_note? }`.
3. **Verify the quote in code** — check `quote` is a substring of `before_text`. This is not delegated to the LLM. If it fails, `quote_verified=false` and the review UI surfaces "quote not verified" instead of silently trusting the AI. This is the concrete implementation of "AI should not just provide changes without senior source."
4. Persist as a `lessons` row with `status='pending_review'`. Trace `status` flips to `'extracted'`.

**Failure modes:**
- LLM call fails / times out → trace stays `status='captured'`, no lesson row created, error surfaced to the submitter with a retry action.
- LLM returns unparseable output → same as above, logged for debugging.
- Quote doesn't verify → lesson is still created (senior can still review and manually fix the quote), just flagged.

---

## 7. Review & Promotion

Review queue (`GET /lessons?status=pending_review`) shows each lesson with the AI's guesses editable inline:

- Quote, what changed, why it matters — free-text fields, pre-filled, editable.
- Typology — dropdown, pre-filled with the AI's guess, senior can override. This directly answers "ask senior to confirm a AI generated guess as to why the change is made" with a fixed typology.
- Playbook alignment — shown as a banner. If `diverges`, rendered prominently (not just informational) — "This edit diverges from playbook `NDA §4.3`. Confirm this is intentional or note why." This is the "system should tell them outrightly they should follow it" requirement.
- Actions: **Confirm & Promote**, **Save as Draft** (stays `pending_review` with edits saved via `PATCH`, decide later), **Reject** (`PATCH` sets `status='rejected'`, excluded from the library).

"Confirm & Promote" is a single call: `POST /lessons/:id/promote` accepts the (possibly edited) field values in its body, so the UI doesn't need a separate save-then-promote round trip. "Save as Draft" uses `PATCH /lessons/:id` alone, leaving `status='pending_review'`. Promoting:

1. Applies any edited field values from the request body.
2. Runs one redaction LLM call over `quote` / `why_it_matters` to strip obvious proper nouns (client names, matter names) — the "privacy by design" step. This is a best-effort pass, not a compliance-grade PII scrubber; documented as a known limitation.
3. Sets `status='promoted'`, `promoted_at=now`, `reviewer`, `reviewed_at`.
4. The lesson becomes visible in `GET /lessons?status=promoted` — the shared Library view.

`POST /lessons/:id/promote` only accepts lessons with `status='pending_review'` (rejects `rejected` or already-`promoted` lessons) — nothing reaches the shared library without going through this endpoint, and this endpoint always requires a `reviewer` name in its body. Enforced in code, not just convention.

---

## 8. API

```
POST   /traces                    { before_text, after_text, playbook_ref?, playbook_text?, context_note?, submitted_by }
POST   /traces/:id/extract        manual extraction trigger

GET    /lessons?status=           list, filterable by status / typology / playbook_ref
GET    /lessons/:id
PATCH  /lessons/:id               reviewer edits fields in place, or sets status='rejected'
POST   /lessons/:id/promote       apply edits + redact + publish to shared library (requires reviewer name)
```

---

## 9. LLM Provider Abstraction (bring-your-own-model)

```ts
interface LLMProvider {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
  redact(text: string): Promise<string>;
}
```

Two built-in implementations:

- **Anthropic** (default) — `@anthropic-ai/sdk`, structured output via forced tool-use.
- **OpenAI-compatible** — plain `fetch` against a configurable `base_url`; covers OpenAI itself, Ollama, LM Studio, vLLM, and any other server that speaks the OpenAI chat-completions shape.

Selected via env vars: `LLM_PROVIDER` (`anthropic` | `openai_compatible`), `LLM_API_KEY`, `LLM_BASE_URL` (openai_compatible only), `LLM_MODEL`. A firm can point this at their own hosted/fine-tuned model without code changes.

---

## 10. Configuration

```
DB_PATH=./data/birdie.db
AUTO_EXTRACT=true
LLM_PROVIDER=anthropic
LLM_API_KEY=
LLM_MODEL=claude-sonnet-5
LLM_BASE_URL=            # only used when LLM_PROVIDER=openai_compatible
PORT=4000
```

---

## 11. Error Handling

- All API errors return `{ error: string }` with an appropriate HTTP status; no raw stack traces to the client.
- Extraction failures are non-fatal to trace capture — the trace is saved regardless; extraction can be retried.
- Quote-verification failure is a data flag (`quote_verified=false`), never a hard error — the senior can still review and fix it manually.
- SQLite file is created on first run if missing; schema migration runs at startup (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## 12. Testing

Given this is a scaffold, testing is thin but real — focused on the two pieces of logic that can silently misbehave rather than broad coverage:

- **Quote verification** — substring match logic (`backend/test/extraction.test.ts`): exact match, whitespace/formatting differences, no match.
- **Extraction response parsing** — validating the LLM's structured output against the expected shape, handling malformed/partial responses.

No end-to-end or UI test suite in v1; manual verification of the capture → extract → review → promote loop via `/verify` before considering the scaffold done.

---

## 13. Build Order

1. Repo scaffold — npm workspaces root, `backend/` and `web/` packages, TypeScript config, SQLite schema + migration.
2. `POST /traces` + `GET /lessons` — capture and list, no extraction yet (stub lesson creation to unblock UI work).
3. LLM provider abstraction + Anthropic implementation + extraction pipeline (quote verification, typology, playbook alignment).
4. `PATCH /lessons/:id`, `POST /lessons/:id/promote` (with redaction pass).
5. OpenAI-compatible provider.
6. Web UI: Capture screen → Review screen → Library screen, wired to the API.
7. Unit tests for quote verification + extraction parsing.
8. README with setup/run instructions, `.env.example`.

---

## References

- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/features/birdie-mentor.md` — mentor persona and framing this project borrows its name and spirit from.
- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/rfc-review-handoff.md` (superseded in that project) — the structured extraction/review/promotion pattern this design adapts.
- `/Users/nigel/Projects/LexCatalyst/LexCatalyst/docs/product-requirement.md` — original whiteboard notes on the mentorship pain points this addresses.
