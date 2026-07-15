# Birdie Hot-Swappable Database and Search Design

**Date:** 2026-07-15
**Status:** Approved for implementation planning

## Summary

Birdie will separate authoritative persistence from lesson retrieval behind two documented TypeScript interfaces: `DBAdapter` and `SearchAdapter`.

The zero-configuration deployment remains SQLite. Its built-in search combines word-based FTS5/BM25 ranking with trigram FTS5 matching for partial words and typo tolerance. It does not call a model or external API.

This implementation will also ship first-party PostgreSQL and pgvector adapters. The PostgreSQL search adapter will work without an external model by generating deterministic hashed character-trigram vectors. Custom builds can inject a different vectorizer to provide genuine semantic embeddings.

The built-in adapter pair is selected through environment variables. Custom adapters are wired into a Birdie build through the exported TypeScript interfaces; Birdie will not dynamically load arbitrary packages at runtime.

## Goals

- Keep the default Birdie setup as easy as the current SQLite deployment.
- Remove SQLite-specific persistence and FTS behavior from application services.
- Make the database and retrieval implementations independently replaceable.
- Ship a usable PostgreSQL/pgvector implementation in this pass.
- Require no model, tokenizer service, API key, or network call for either built-in search strategy.
- Preserve the same REST, web, and MCP behavior across adapter combinations.
- Give custom builds a documented, stable TypeScript extension surface.

## Non-goals

- Claim that the built-in trigram strategies understand semantic similarity. They provide lexical, substring, and fuzzy relevance.
- Dynamically discover or import third-party adapters from environment-provided module paths.
- Ship an OpenAI, Cohere, Hugging Face, or other hosted embedding integration.
- Support every possible combination of the built-in database and search adapters.
- Add distributed job infrastructure. Search synchronization will use a small in-process retry mechanism.

## Terminology

- **Database adapter:** the authoritative store for Birdie and the database connection supplied to Better Auth.
- **Search adapter:** a derived retrieval index that returns ranked lesson identifiers.
- **Vectorizer:** a function that converts text into a fixed-length numeric vector. The built-in pgvector vectorizer hashes character trigrams; a custom vectorizer may call a model.
- **Semantic search:** reserved for a search adapter backed by semantic embeddings. The built-in search must be described as hybrid lexical or fuzzy search.

## Architecture

### Adapter bundle

Birdie receives its infrastructure as one bundle while retaining separate database and search contracts:

```ts
export interface BirdieAdapters {
  db: DBAdapter;
  search: SearchAdapter;
}
```

`createDefaultAdapters(config)` constructs one of the supported built-in pairs. `buildHostedContext()` also accepts an explicit `BirdieAdapters` value so a custom build can supply its own implementations.

All adapter and service operations are asynchronous. SQLite implementations may resolve immediately, but PostgreSQL must not require a later public-contract change.

### Database contract

Repository behavior becomes a database-neutral store contract. Transaction callbacks receive a transaction-scoped session so PostgreSQL queries cannot accidentally escape their transaction.

```ts
export interface DBSession {
  traces: TraceStore;
  lessons: LessonStore;
  users: UserAdminStore;
}

export interface DBAdapter extends DBSession {
  readonly authDatabase: BetterAuthOptions['database'];
  initialize(): Promise<void>;
  transaction<T>(work: (session: DBSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`TraceStore` and `LessonStore` cover the current repository operations. `UserAdminStore` contains only the direct user queries Birdie needs for initial administrator bootstrap and last-enabled-administrator protection. General authentication and user management remain owned by Better Auth.

`authDatabase` is the database connector Better Auth expects for the selected engine:

- SQLite supplies the shared `bun:sqlite` database handle.
- PostgreSQL supplies a Kysely PostgreSQL dialect backed by the adapter's shared `pg` pool.

The DB adapter owns the underlying handle or pool. Birdie must not open a second connection to the same SQLite file merely for authentication.

### Search contract

```ts
export interface SearchFilter {
  status?: LessonStatus;
  submittedBy?: string;
  submittedByUserId?: string;
}

export interface SearchRequest {
  query: string;
  filter: SearchFilter;
  limit: number;
}

export interface SearchHit {
  lessonId: string;
  score: number;
}

export interface SearchAdapter {
  initialize(): Promise<void>;
  index(lesson: LessonWithTrace): Promise<void>;
  remove(lessonId: string): Promise<void>;
  search(request: SearchRequest): Promise<SearchHit[]>;
  rebuild(lessons: AsyncIterable<LessonWithTrace>): Promise<void>;
  close(): Promise<void>;
}
```

Scores are meaningful only within one adapter call. Application code relies on hit ordering, not on a shared score scale across implementations.

Search adapters may store filterable metadata, but they do not own authorization policy. The service constructs filters from the authenticated request, and hydration through `DBAdapter` is the final source-of-truth check.

## Authentication and Database Ownership

The current code passes a SQLite handle directly to Better Auth and also executes SQLite-specific user queries during administrator bootstrap and user administration. A database swap therefore must include these paths; changing lesson repositories alone would leave the application tied to SQLite.

Startup will be reorganized as follows:

1. Parse and validate runtime configuration.
2. Construct the selected adapter bundle.
3. Construct Better Auth with `adapters.db.authDatabase`.
4. Run Better Auth migrations.
5. Run `DBAdapter.initialize()` for Birdie's tables and indexes.
6. Run `SearchAdapter.initialize()` for its derived index.
7. Bootstrap the administrator through `DBAdapter.users` and Better Auth APIs.
8. Build the application context and start MCP and HTTP servers.

Shutdown closes HTTP and MCP first, then the search adapter and DB adapter. Close operations must tolerate shared resources and repeated cleanup after partial startup failure.

## Runtime Configuration

SQLite remains the default when the adapter variables are absent:

```env
BIRDIE_DB_ADAPTER=sqlite
BIRDIE_SEARCH_ADAPTER=sqlite
DB_PATH=/data/birdie.db
```

PostgreSQL with pgvector is selected explicitly:

```env
BIRDIE_DB_ADAPTER=postgres
BIRDIE_SEARCH_ADAPTER=pgvector
DATABASE_URL=postgresql://user:password@host:5432/birdie
```

Rules:

- `BIRDIE_DB_ADAPTER` accepts `sqlite` or `postgres` and defaults to `sqlite`.
- `BIRDIE_SEARCH_ADAPTER` accepts `sqlite` or `pgvector` and defaults to `sqlite`.
- `DB_PATH` retains its current default and is used only by SQLite.
- `DATABASE_URL` is required when either selected adapter needs PostgreSQL.
- The supported built-in pairs are `sqlite` plus `sqlite`, and `postgres` plus `pgvector`.
- Unsupported built-in combinations fail before opening a listener and name the incompatible values.
- Secrets and database URLs are never logged.

Custom builds bypass built-in adapter selection by constructing `BirdieAdapters` and passing them to the exported startup/context functions.

## Default SQLite Search

`SQLiteSearchAdapter` shares the SQLite handle owned by `SQLiteDBAdapter`. It maintains two derived FTS5 tables containing only promoted lessons:

- A word index using FTS5's Unicode word tokenizer and BM25 ranking.
- A trigram index using FTS5's trigram tokenizer for substrings, partial terms, and typo recovery.

For a nonblank query:

1. Normalize Unicode, case, and repeated whitespace.
2. Search the word index with safely quoted terms.
3. Search the trigram index when the normalized query is at least three characters.
4. Merge the two ranked lists with weighted reciprocal-rank fusion. Word results receive the larger weight.
5. Break equal fused ranks by the newest `promoted_at` value.
6. Apply the requested limit.

Reciprocal-rank fusion avoids pretending that FTS5 BM25 scores from different tokenizers are directly comparable.

If FTS5 is unavailable, the adapter falls back to the existing case-insensitive `LIKE` behavior. This fallback preserves startup and basic retrieval; it is not expected to reproduce typo tolerance or the same ranking.

Promotion and edits to promoted lessons call `index()`. Rejection and deletion call `remove()`. `rebuild()` drops and recreates the derived FTS data from promoted lessons supplied by `DBAdapter`.

## PostgreSQL Database Adapter

`PostgresDBAdapter` uses a shared `pg` pool. It supplies a Kysely PostgreSQL dialect to Better Auth and implements Birdie's stores with parameterized PostgreSQL queries.

The adapter migration will:

- Create Birdie's `traces` and `lessons` tables using the existing UUID strings, timestamps, statuses, attribution fields, and foreign-key relationships.
- Preserve Better Auth's ownership of its own tables and migrations.
- Create the existing status and trace relationship indexes.
- Maintain an adapter-owned migration table so migrations are ordered and rerunnable.

Migrations are additive and must not drop unrelated schemas, tables, extensions, or rows. The PostgreSQL integration test setup uses a dedicated schema or database rather than resetting a shared database.

## PostgreSQL pgvector Search

`PgVectorSearchAdapter` stores one derived search document per promoted lesson. The row contains the lesson identifier, filterable attribution/status metadata, the source text fingerprint, the vectorizer identifier, and a fixed-dimension vector.

Its initialization owns the search-specific migration: it enables the `vector` extension with `CREATE EXTENSION IF NOT EXISTS vector`, creates the derived search table, and creates its vector index. `PostgresDBAdapter` therefore remains usable without owning pgvector-specific schema.

The searchable document combines fields with explicit weights:

- `quote`: highest weight.
- `what_changed`: medium weight.
- `why_it_matters`: normal weight.

The built-in `HashedTrigramVectorizer`:

1. Normalizes Unicode, case, and whitespace.
2. Generates boundary-aware character trigrams.
3. Uses a stable signed hash to accumulate trigram counts into a fixed 512-dimensional vector.
4. Applies field weights during accumulation.
5. L2-normalizes the result for cosine distance.

This is deterministic, local, and model-free. It improves fuzzy lexical matching but is not semantic embedding. The vectorizer exposes a stable identifier and dimension so incompatible index contents are detected rather than silently mixed.

The pgvector table uses `vector(512)` and cosine distance. Its migration creates an HNSW cosine index where supported. Search filters promoted status and attribution in SQL before applying the requested limit.

`PgVectorSearchAdapter` accepts an injected vectorizer contract:

```ts
export interface Vectorizer {
  readonly id: string;
  readonly dimensions: number;
  embed(input: SearchDocument): Promise<number[]>;
  embedQuery(query: string): Promise<number[]>;
}
```

The environment-selected adapter uses `HashedTrigramVectorizer`. A custom build may inject a model-backed vectorizer. A different dimension or vectorizer identifier requires a rebuilt compatible index; Birdie must fail clearly rather than query mismatched vectors.

## Application Data Flow

### Listing without search

`LessonService.list()` calls `DBAdapter.lessons.list()` directly when `q` is absent or normalizes to an empty string. Existing status, submitter, ownership, and limit behavior remains unchanged.

### Searching

1. The REST or MCP layer validates the query and constructs application-owned filters.
2. `LessonService` calls `SearchAdapter.search()`.
3. The search adapter returns ordered `SearchHit` values.
4. `LessonService` asks `DBAdapter.lessons.getByIds()` to hydrate those IDs while reapplying visibility filters.
5. Missing, deleted, stale, or no-longer-visible lessons are discarded.
6. Results are returned in search-hit order.

The web knowledge base continues to use `GET /lessons?q=...`. MCP `ask_lesson` continues to retrieve promoted lessons for client-side synthesis. No public API shape needs to change.

### Writes and index synchronization

1. Commit the authoritative lesson mutation through `DBAdapter`.
2. Call `SearchAdapter.index()` for a promoted lesson or `remove()` when it should no longer be searchable.
3. If indexing fails after the database commit, retain the committed business record, log a redacted error, and enqueue a bounded in-process retry.
4. Hydration prevents stale search rows from exposing deleted or unauthorized records.
5. The rebuild command restores the entire derived index from the database.

The default SQLite pair may coordinate its index write on the shared SQLite connection and transaction. The generic contract does not promise a distributed transaction between arbitrary database and search adapters.

The retry queue is deliberately small and in-process. Exhausted retries produce an actionable log entry directing the operator to rebuild the search index. Durable distributed indexing is outside this design's scope.

## Rebuild Command

The CLI gains an explicit administrative command:

```text
birdie rebuild-search
```

It initializes the configured adapters, streams promoted lessons from `DBAdapter`, invokes `SearchAdapter.rebuild()`, reports counts without printing lesson content, and closes resources. Rebuild is safe to run repeatedly.

The server does not perform a full rebuild on every startup. Adapter initialization may create missing index structures, but expensive re-embedding remains an explicit operation.

## Error Handling

- Invalid adapter configuration fails during config parsing with the relevant variable names.
- Connection and migration failures prevent server startup.
- Missing PostgreSQL `vector` privileges or extension support produces a targeted startup error.
- An invalid vector length, non-finite vector value, or vectorizer mismatch fails indexing before writing corrupt search data.
- Search errors return the existing service error shape and do not silently degrade from pgvector to a different result set.
- SQLite alone may use its documented `LIKE` fallback when FTS5 is unavailable.
- Logs include adapter names and operation names but exclude credentials, database URLs, lesson text, and vectors.

## Package and Source Layout

The implementation should keep interfaces and engine-specific code isolated:

```text
backend/src/adapters/
  types.ts
  factory.ts
  sqlite/
    dbAdapter.ts
    searchAdapter.ts
  postgres/
    dbAdapter.ts
    searchAdapter.ts
    hashedTrigramVectorizer.ts
```

Existing repository logic moves behind `TraceStore` and `LessonStore` implementations. Application services depend only on adapter types. Better Auth integration accepts the selected adapter's `authDatabase` and user administration store.

Direct runtime dependencies include `pg`, `kysely`, and a pgvector serialization/registration package if required by the chosen driver implementation. They are server dependencies only and do not affect the web bundle.

## Testing

Testing remains focused on behavior and adapter parity:

- A shared DB adapter contract suite covers trace creation, lesson lifecycle, filters, stable user attribution, ordering, limits, transactions, and deletion.
- A shared search adapter contract suite covers exact terms, partial terms, a representative typo, attribution filters, promotion, edits, deletion, ranking order, and rebuild.
- SQLite tests run by default in memory.
- PostgreSQL tests run only when `TEST_DATABASE_URL` is present and use a unique test schema or dedicated database.
- Hashed trigram vectorizer tests verify determinism, dimension, finite normalized values, field weighting, and distinct vectors for distinct input.
- Runtime configuration tests verify defaults, PostgreSQL requirements, supported pairs, and secret-safe failures.
- Existing route, service, MCP, auth bootstrap, build, and type checks remain green after conversion to async adapters.

Live PostgreSQL verification uses the operator-provided test connection through `TEST_DATABASE_URL`; credentials are not committed or echoed.

## Documentation

The README and deployment documentation will explain:

- SQLite remains the recommended quick start.
- The exact PostgreSQL/pgvector environment variables and extension requirement.
- The built-in search is lexical/fuzzy, not model-based semantic retrieval.
- How to rebuild the configured search index.
- How to implement and inject custom `DBAdapter`, `SearchAdapter`, and `Vectorizer` implementations.
- That changing vectorizers requires rebuilding a compatible index.

## Acceptance Criteria

- With no new environment variables, Birdie starts on SQLite and searches promoted lessons through hybrid word/trigram retrieval.
- Existing REST, web, OAuth, administrator, and MCP workflows behave as before.
- With the PostgreSQL adapter variables and a valid database URL, Birdie runs its auth, trace, lesson, and pgvector storage on PostgreSQL.
- PostgreSQL search works with the built-in hashed trigram vectorizer and no model API.
- Search results remain filtered, hydrated, and ordered correctly.
- `birdie rebuild-search` safely rebuilds either built-in index.
- Custom builds can provide adapters and vectorizers through exported TypeScript interfaces without changing application services.
- SQLite and PostgreSQL pass the same relevant adapter contract suites.
