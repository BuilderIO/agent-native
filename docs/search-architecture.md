# Search index architecture

Status: proposed, revision 2. This is the API sketch for the core search layer,
written before implementation. Revision 2 incorporates an independent
design review; the main changes are whole-resource matching, access checked
inside the query, change capture by database triggers, and a search-owned
queue driver. Update this document when the design changes.

## Decision

Search is a core capability that apps opt into, the same way they opt into
sharing. An app declares which table is searchable, how to turn rows into
searchable text, and the SQL condition that decides who may find a row. Core
maintains an index in that app's own database, keeps it fresh as rows and
permissions change, and provides a search library plus an action factory. The
resulting actions serve the app's UI, its agent, MCP clients, and other apps
over A2A.

Search does its work at write time instead of on every keystroke. Queries read
an index, not raw document text.

This does not conflict with [command-menu-architecture.md](./command-menu-architecture.md).
That document keeps the command menu from becoming a universal data index or
importing app routes. Here, each app indexes only its own data in its own
database, and the command menu consumes app search through async providers.
Core owns generic index SQL; apps own their resource rules. No app is required
to use it.

It builds on the existing `@agent-native/core/search` primitives (rank fusion,
per-dimension pgvector tables). Brain and Creative Context keep their current
namespaced tables; this layer adds its own fixed tables.

## Shape of the system

| Lane     | Where   | What it matches                                        | When                        |
| -------- | ------- | ------------------------------------------------------ | --------------------------- |
| Title    | Browser | Titles the app already loaded, including fuzzy matches | Every keystroke, no network |
| Lexical  | Server  | Words and word prefixes in title, summary, and body    | After a short debounce      |
| Semantic | Server  | Meaning, via chunk embeddings (hosted Postgres only)   | Later                       |

One ordering function defines results for every caller. Modes change only the
latency budget, never the result set or its order. The last query term is
always a prefix, for people and agents alike. When the semantic lane exists,
it is fused the same way for every caller. The UI may show lexical results
first, but its final state equals what an agent gets for the same inputs.

## Registration

```ts
import { registerSearchableResource } from "@agent-native/core/search";

registerSearchableResource({
  app: "content",
  type: "document", // matches the shareable resource type
  getDb,
  table: schema.documents,
  sharesTable: schema.documentShares,
  version: 1, // bump when projection logic changes; triggers a rebuild

  // Batched and async: rows -> searchable text and prefilter fields.
  // Return null for a row to keep it out of the index.
  async load(ids, db) {
    return projectDocuments(ids, db); // title, summary, body, updatedAt, filters
  },

  // The exact access and eligibility condition, as SQL over the source table,
  // joined into the candidate query. For Content: documentDiscoveryWhere with
  // the caller's orgs and live filters, plus hideFromSearch for query searches.
  authorizeWhere(caller, filters) {
    return contentSearchWhere(caller, filters);
  },

  // Validated org memberships the caller searches across.
  callerOrgIds: (caller) => authorizedOrgIdsFor(caller),

  deepLink: (hit) =>
    buildDeepLink({ app: "content", view: "page", params: { id: hit.id } }),
});
```

Rules:

- **Project only the resource's own text.** A child never indexes its parent's
  title. Breadcrumbs are resolved at query time from ancestors the caller can
  see.
- **Filters in the index are prefilters only.** They can be stale; for example,
  a cross-space move doesn't touch every descendant's `updatedAt`, and a
  document's type comes from `content_databases`. `authorizeWhere` re-applies
  every filter live against the source rows.
- **`authorizeWhere` must match what the app already trusts for listing.** For
  Content that is `documentDiscoveryWhere` plus the `hideFromSearch` clause
  that `search-documents` adds for query searches.

## Tables

Created at release through `FRAMEWORK_SCHEMA_ENSURES`, additive only, fixed
names, scoped by `app` and `resource_type`. That keeps them safe in self-built
workspaces where several apps share one database.

- **`search_resources`**: one row per resource, used for matching and access.
  - `title_norm` (btree, `text_pattern_ops`) for title tiers.
  - `title_vector` (`'simple'`, GIN) for word-prefix title matches.
  - `doc_vector` (`'simple'`, GIN): title A, summary B, whole body C. When a
    body would exceed tsvector limits (1 MB, 16,383 positions), its body part
    is `strip()`ped; phrase checks then fall to chunks.
  - `audience text[]` (GIN), prefilter columns (`scope`, `parent`, `kind`,
    `modified_at`, `extra jsonb`).
  - Bookkeeping: `content_hash`, `acl_hash`, `source_updated_at`,
    `index_version`, `indexed_at`.
- **`search_chunks`**: body chunks, used only to rank passages and build
  snippets for final candidates. Stores the chunk vector, raw-source start and
  end offsets, and a chunk hash. Chunks overlap by at least the longest
  supported phrase.
- **`search_queue`**: `(resource_type, resource_id)` primary key, `reason`,
  `enqueued_at`, `attempts`.
- **`search_index_state`**: per `app` and `resource_type`: `index_version`,
  `rebuild_started_at`, `rebuild_completed_at`.
- Later: `search_vocabulary` (typo correction), `resource_views` (recently
  opened), `search_misses` (failed searches), and per-dimension pgvector
  tables (semantic search).

Everything uses an explicit `'simple'` text-search configuration: no stemming,
no stopwords, identical on Neon and PGlite. A stemmed body vector can be added
later if the relevance eval shows it helps.

### Tokens beyond the Postgres parser

Word search loses things substring search found. At index time and query time,
core adds extra tokens:

- **Compound words:** camelCase, snake_case, and kebab-case split into their parts.
- **URLs and paths:** host and path segments.
- **CJK text:** overlapping character bigrams, because Postgres doesn't
  segment Chinese or Japanese.

Mid-word matches in bodies ("port" inside "report") are deliberately not
matched. Titles keep mid-word matching through the browser lane and the title
tiers.

## Access

`authorizeWhere` is the authority, and it runs inside the candidate query.
Because unauthorized rows never become candidates:

- `OFFSET` counts only visible rows;
- `limit + 1` gives an exact `hasMore`;
- no post-filter loop can leak or stall.

Audience tokens are a GIN prefilter that keeps that live check cheap on broad
queries:

| Grant            | Row token                           | Notes                                                                                     |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Owner            | `u:<email>` or `u:<email>@<org\|->` | Org-qualified unless `ownerAccessIgnoresOrg`; a no-org form for user-only contexts        |
| Org visibility   | `o:<orgId>`                         | Caller org IDs must be validated memberships                                              |
| Share to a user  | `su:<email>`                        | Org-qualified under `requireOrgMemberForUserShares`                                       |
| Share to an org  | `o:<orgId>`                         | Only when the principal org equals the resource org under `requireOrgMemberForUserShares` |
| Share to a group | `g:<orgId>:<groupId>`               | Caller holds it when a live member of that group in that org                              |

Emails are lowercased. Caller tokens are computed after `resolveAccessContext`
from live, validated memberships, so joining or leaving orgs and groups needs
no reindexing. A registration whose access comes from outside `accessFilter`
(for example `canManageAccess`) sets `prefilter: false` and relies on
`authorizeWhere` alone.

## Keeping the index fresh

`updatedAt` can't drive freshness. Sharing changes don't touch it, cascades
update rows without bumping it, it's stored as text in mixed formats, and a
`CURRENT_TIMESTAMP` default is the transaction's start, not its commit.
Instead:

1. **Change capture by triggers.** Each registration installs AFTER triggers on
   its source table and its shares table, through an app migration that uses
   core-provided SQL. The triggers upsert into `search_queue` in the writer's
   own transaction. This catches every writer, including sync jobs, raw SQL,
   subtree cascades, and deletes, and nothing is enqueued unless the write
   commits. A startup check fails loudly if a registered table lacks its
   triggers.
2. **Read-your-writes.** Before querying, the search library drains pending
   queue entries for that app within a small budget (for example, 100 ms).
   The editor's next search, and anyone else's, sees committed changes. Heavy
   backlogs such as a rebuild are left to the background driver.
3. **Background driver.** Search owns its own driver:
   - an in-process interval on long-lived servers and local development;
   - a `registerRecurringSweepHandler` handler for Netlify, time-boxed because
     handlers run in series.

   An advisory lock or lease keeps overlapping runs from double-processing. The
   recurring-jobs runtime doesn't run sweep handlers locally or on other
   serverless platforms, which is why search can't rely on it alone.

4. **Safe writes.**
   - Indexing reads the source row and its shares, then writes the
     `search_resources` row only if its stored `source_updated_at` and
     `acl_hash` are not newer.
   - A queue row is deleted only if its `enqueued_at` is unchanged since it
     was read, so a newer enqueue is never swallowed.
5. **Rebuilds.** A new `index_version` enqueues every row in batches
   (`INSERT … SELECT id`), which avoids cursors over random IDs. Until the
   rebuild completes, the app's existing search path serves requests, and the
   response reports `indexComplete: false`.
6. **Reconciliation.** A slow batched job compares `content_hash` and
   `acl_hash` with the source and requeues differences. Queue depth, queue
   age, and index lag are reported as metrics.

Unchanged content only refreshes audience and filters. Chunks are rewritten
only when their hash changes, so autosave on a 200 KB page doesn't reindex the
whole body.

## Querying

At most three round trips:

1. **Caller context:** validated org and group memberships, often already
   loaded by the request.
2. **The ranked page.** One statement over `search_resources`, joined to the
   source table:
   - it filters by `app`, `type`, prefilters, `audience && caller tokens`,
     `authorizeWhere`, and the match;
   - it orders by title tier (string expressions on `title_norm`, the same
     rules the browser lane uses), then `ts_rank_cd` on `doc_vector`, then
     personal signals as of the cursor's snapshot time (once views are
     recorded), then
     `updatedAt`, then ID;
   - it returns `limit + 1` rows at the cursor's offset.

   For broad queries, passage ranking over chunks applies only to a
   deterministic top slice (for example, the first 200 by document rank), so
   pagination stays stable.

3. **Snippets and breadcrumbs** for the returned rows only. Each snippet reads
   `substring(source, start, end)` for the best chunk, verifies the chunk hash
   (falling back to the summary on mismatch), strips the chunk, and locates
   the match. Breadcrumbs come from authorized ancestors.

The query compiler builds the `tsquery` in SQL from parsed terms, so operator
characters in user input can't break it. Content's parser
(`templates/content/shared/search-query.ts`) moves to core. Its operators keep
their meaning: phrases, `-term`, uppercase `OR`, `intitle:`, and implicit AND.
They are evaluated against the whole resource. Phrases are verified on chunks.

Cursors encode the engine (legacy or index), `index_version`, offset, and
signal snapshot time. A cursor from one engine is rejected by the other, and
the search restarts.

The typo fallback draws its suggestions only from vocabulary the
caller may see. Vocabulary rows carry audience tokens, and "matched nothing"
is decided after authorization, so a suggestion can't reveal a word from a
document the caller can't open.

## Library and actions

Core exports:

- **`searchResources(options)`**: the library call described above, returning
  a `SearchPage`.
- **`createSearchAction(options)`**: a factory for a read-only action (`http`
  GET, `readOnly`, `mcpTool`), in a new `search` framework tool group.
- A per-app **`search`** action that fans out across the app's registered types
  with a `types` filter. The app's agent card advertises it and its schema, so
  A2A callers use one well-known name.

Apps with an existing contract keep their own action. Content keeps
`search-documents` and calls `searchResources`; its inputs (`exactTitle`,
`excludeSubtreeOf`, `searchFields`, offset paging) and outputs stay, minus
exact totals. Core registration never overrides an app-defined action of the
same name.

```ts
interface SearchResult {
  app: string;
  type: string;
  id: string;
  title: string;
  snippet: string | null;
  path: string[]; // authorized ancestors only
  url: string; // buildDeepLink
  updatedAt: string;
  lane: "title" | "lexical" | "typo" | "semantic";
  score: number;
  reasons: string[]; // e.g. "title prefix", "body phrase", "recently opened"
  extras?: Record<string, unknown>;
}

interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
  nextCursor: string | null;
  indexComplete: boolean;
  semantic: "complete" | "unavailable" | "skipped";
}
```

## Browser lane

`@agent-native/core/client/search` will export a hook that takes the query, the
app's already-loaded items, the filters, and returns merged results:

- **On every keystroke**, it shows title matches for the current query, so the
  list never goes blank.
- **Server results from an earlier query are never shown** as results for the
  current one, per the command-menu rule on stale async results. The server
  lane shows a loading row until its results for the current query arrive.
- **When server page one arrives,** the list takes the server's order.
  Browser-only matches, such as fuzzy title matches, follow it, with no
  duplicates. For the tiers both lanes implement, the browser uses the
  server's exact tie-breaks, so this convergence rarely moves the top result.
- **Only the first page** gets browser-lane results.
- **It only ever shows titles the app already shows** (for Content, the sidebar
  list), so it exposes nothing new. The app refreshes that list when sharing
  changes.

Content builds this first, inside its command search. Core then lifts it, where it can
back a `CommandSearchProvider` when the shared command menu lands.

## Runtime notes

- **PGlite (local):** the lexical lane and triggers work. The typo fallback
  needs `pg_trgm`, which core's PGlite client must pass at construction. There
  is no semantic lane; the action reports `semantic: "unavailable"`.
- **Neon:** `pg_trgm` and `vector` are created at release.
- **Serverless:** writes don't wait on indexing. Search drains its own small
  backlog, and the background driver handles the rest.
- **Shared-database workspaces:** `app` and `resource_type` keep apps apart.
  The latency harness includes other tenants' rows.

## Testing

- **Core:**
  - token derivation checked against `accessFilter` for every registration
    flag;
  - triggers capture every write kind (insert, update, cascade, delete, share
    grant and revoke);
  - races (stale indexer, re-enqueue during processing);
  - AND and negation across chunks, and phrases across chunk boundaries;
  - cursor stability and engine switches;
  - rebuild completeness;
  - runs on PGlite and on the Postgres service container.
- **Content:**
  - the relevance eval, including infix, camelCase, URL, and CJK cases;
  - lifecycle tests for share, unshare, visibility, cross-space moves,
    hide-from-search on a subtree, and inline database deletion;
  - latency measured against Neon on 10,000-document corpora with short and
    long bodies: p95 at or under 400 ms for each query class.

## Decisions made in revision 2

- **Trigger installation:** core exports the trigger SQL for a registration.
  Apps add it as a named migration: Content through `runMigrations` in
  `server/plugins/db.ts`. The startup check catches a missing trigger.
- **Caller orgs:** `callerOrgIds` defaults to the active org only. Content opts
  into its existing multi-org search.

## Open questions

1. Is a 100 ms read-your-writes drain budget compatible with the 400 ms p95
   target when an import leaves a large backlog? The alternative is draining
   only the caller's own recent writes. Measure before choosing.
