# Search index architecture

Status: accepted, revision 3. Revision 1 was the API sketch written before
implementation. Revision 2 incorporated an independent design review:
whole-resource matching, access checked inside the query, and change capture by
database triggers. Revision 3 records the first implementation. Change capture
became a general resource change feed that search consumes, search never wakes
a sleeping database, and core tokenizes text itself. Each section says what is
built and what is planned. Update this document when the design changes.

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

## Built so far

- **Core:** the resource change feed (`packages/core/src/resource-changes/`),
  the index tables, the indexer, the query SQL, and the query parser, exported
  from `@agent-native/core/search` and `@agent-native/core/search-query`.
- **Content:** registers `documents`, installs change capture as migration
  117, and `search-documents` answers from the index when it's ready. When it
  isn't, the request falls back to the scan Content used before the index.
- **Not built yet:** the `searchResources` library call, `createSearchAction`,
  the per-app `search` action, cursors, chunks and passage snippets, audience
  tokens, `ts_rank_cd` ordering, the typo fallback, the semantic lane, and
  lifting the browser lane into core. Until the library call exists, an app
  composes the index into its own query (see [Querying](#querying)).

## Shape of the system

| Lane     | Where   | What it matches                                                  | When                        |
| -------- | ------- | ---------------------------------------------------------------- | --------------------------- |
| Title    | Browser | Titles the app already loaded, including fuzzy matches           | Every keystroke, no network |
| Lexical  | Server  | Substrings of titles and summaries; words and prefixes in bodies | After a short debounce      |
| Semantic | Server  | Meaning, via chunk embeddings (hosted Postgres only)             | Later                       |

One ordering function defines results for every caller. Modes change only the
latency budget, never the result set or its order. The last query term is
always a prefix, for people and agents alike. When the semantic lane exists,
it is fused the same way for every caller. The UI may show lexical results
first, but its final state equals what an agent gets for the same inputs.

## Registration

Built:

```ts
import {
  registerSearchableResource,
  searchIndexMigration,
} from "@agent-native/core/search";

export const documentSearchIndex = registerSearchableResource({
  app: "content",
  type: "document", // matches the shareable resource type
  table: schema.documents,
  idColumn: schema.documents.id,
  version: 1, // bump when load() changes; the index rebuilds

  // Batched: IDs -> title, summary, body, modifiedAt. An ID left out of the
  // result is removed from the index.
  async load(ids) {
    return projectDocuments(ids);
  },
});

// In the app's runMigrations list: installs the change triggers.
searchIndexMigration(documentSearchIndex, {
  version: 117,
  name: "search-index-documents",
});
```

Planned for the library call and the action factory:

- `sharesTable`, once the index holds audience tokens;
- `authorizeWhere(caller, filters)`, the app's access and eligibility
  condition as SQL over the source table;
- `callerOrgIds(caller)`, the validated orgs the caller searches across; it
  defaults to the active org, and Content opts into its multi-org search;
- `deepLink(hit)`, built with `buildDeepLink`.

Rules:

- **Project only the resource's own text.** A child never indexes its parent's
  title. Breadcrumbs are resolved at query time from ancestors the caller can
  see.
- **The index never decides access.** Filters stored in the index can be stale;
  for example, a cross-space move doesn't touch every descendant's
  `updatedAt`. The source rows decide access and filters, live, in the same
  statement that reads the index.
- **The access condition matches what the app already trusts for listing.**
  For Content that is `documentDiscoveryWhere` plus the `hideFromSearch`
  clause that `search-documents` adds for query searches.

## Tables

Created at release through `FRAMEWORK_SCHEMA_ENSURES`, additive only, fixed
names, scoped by `app` and `resource_type`. That keeps them safe in self-built
workspaces where several apps share one database.

Built:

- **`search_resources`**: one row per resource.
  - `title`, plus `title_norm` and `summary_norm` (NFKC, lowercased) for
    substring matches and title tiers.
  - `doc_vector` (GIN): title at weight A, summary B, body C.
  - `positions_complete`: false when Postgres's limits made the vector drop
    word positions (see [Querying](#querying)).
  - `modified_at`, and bookkeeping: `content_hash`, `index_version`,
    `indexed_seq`, `indexed_at`.
- **`search_index_state`**: per `app` and `resource_type`: `target_version`,
  `index_version`, `rebuild_high_seq`, `rebuild_started_at`,
  `rebuild_completed_at`.
- **`app_resource_changes`** and **`app_resource_change_consumers`**: the
  change feed (see [Keeping the index fresh](#keeping-the-index-fresh)).

Planned:

- `audience text[]` (GIN) and prefilter columns (`scope`, `parent`, `kind`,
  `extra jsonb`), with an `acl_hash`.
- **`search_chunks`**: body chunks, used only to rank passages and build
  snippets for final candidates. Each stores the chunk vector, raw-source start
  and end offsets, and a chunk hash. Chunks overlap by at least the longest
  supported phrase. Chunks also make phrase matching exact in documents whose
  vector lost positions.
- A trigram index on `title_norm`, if title substring matching needs it at
  scale.
- `search_vocabulary` (typo correction), `resource_views` (recently opened),
  `search_misses` (failed searches), and per-dimension pgvector tables
  (semantic search).

### Tokens

Core tokenizes text in JavaScript, never with Postgres's text parser. That
parser depends on the database's locale: on some locales it drops Japanese
entirely, and PGlite and Neon don't agree. Core builds `tsvector` and `tsquery`
literals itself, and Postgres only stores, indexes, and matches them. The same
code tokenizes documents and queries, so they always agree.

- Text is NFKC-normalized and lowercased. There is no stemming and there are
  no stopwords. A stemmed vector can be added later if the relevance eval
  shows it helps.
- A word is a run of letters, numbers, and combining marks. Everything else
  separates words, so `snake_case`, kebab-case, URLs, and paths become their
  parts at consecutive positions, and a query for the same text matches them
  as a phrase.
- A camelCase word is indexed whole and as its parts, so `searchIndexState`,
  `index`, and `index state` all find it.
- Chinese, Japanese, and Korean runs become overlapping character pairs,
  because they have no spaces to split on. A query becomes the same pairs as a
  phrase, which matches exactly that substring.

Mid-word matches in bodies ("port" inside "report") are deliberately not
matched. Titles and summaries match anywhere, including mid-word.

## Access

The access condition runs inside the candidate query. Because unauthorized rows
never become candidates:

- `OFFSET` counts only visible rows;
- totals are exact, and `limit + 1` gives an exact `hasMore`;
- no post-filter loop can leak or stall.

Built: the app's own statement applies its access condition next to the index
join. Content uses the same condition as its listing. The index holds no access
data, so sharing changes need no reindexing.

Planned: audience tokens as a GIN prefilter that keeps the live check cheap on
broad queries. They arrive with `sharesTable`, whose triggers keep them fresh.

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
(for example `canManageAccess`) sets `prefilter: false` and relies on the live
condition alone.

## Keeping the index fresh

`updatedAt` can't drive freshness. Sharing changes don't touch it, cascades
update rows without bumping it, it's stored as text in mixed formats, and a
`CURRENT_TIMESTAMP` default is the transaction's start, not its commit.
Instead:

1. **A general resource change feed.** `app_resource_changes` is a coalescing
   queue of changed resources for each consumer, keyed by consumer, app,
   resource type, and resource ID. Triggers write it in the writer's own
   transaction through one SQL function,
   `agent_native_app_resource_changed(app, type, id, reason)`:
   - after every insert and delete, and after an update only when the row
     actually changed. Rows are compared by their stored bytes, so a table
     with a `json` column, which has no equality operator, still works;
   - a changed primary key is recorded as a delete of the old ID.

   Every writer is caught, including sync jobs, raw SQL, cascades, and
   deletes, and a rolled-back write records nothing. Each entry carries a
   `seq` from one sequence, taken after the row lock, so a later change to the
   same resource always has a higher `seq`. Generated trigger and function
   names end in a hash of the app, table, and resource type, so two sources
   never share them.

   Search is the first consumer. A later one (webhooks, realtime, audit)
   subscribes in `app_resource_change_consumers` and gets its own queue from
   the same triggers. If core ever routes every write through one data layer,
   that layer calls the same function and the triggers retire.

2. **Capture is installed by a migration.** `searchIndexMigration()` installs
   the triggers and subscribes search. If they're missing, search reports
   `capture-missing`, logs an error, and the app's previous search answers.
3. **Search never wakes a sleeping database.** Neon suspends an idle database
   after five minutes, and a self-hoster pays for every minute it's awake. So
   search never polls. It processes changes only when something else already
   has the database awake:
   - before a search, within a 100 ms budget
     (`AGENT_NATIVE_SEARCH_DRAIN_BUDGET_MS`). The search stops waiting when
     the budget runs out, even if it joined a longer drain, such as the
     sweep's. A drain the search started finishes its current batch through
     `waitUntil`, so the changes it holds don't wait out their lease. A budget
     of zero processes nothing before a search;
   - after an action writes, within 250 ms, through `waitUntil` where the
     platform provides it, so the response doesn't wait;
   - in the `search-index` recurring sweep handler, for up to 20 seconds of
     the tick core already runs.

   An app without recurring jobs catches up at its next write or search.

4. **Read-your-writes.** Search answers from the index only when all of these
   are true:
   - the index targets this registration's version;
   - its rebuild is complete;
   - no change is pending or failing.

   One statement reads all of that, in the same round trip as the pending
   check it replaced. Otherwise `prepareSearchIndex()` says why (`backlog`,
   `rebuilding`, `failed-changes`, `capture-missing`,
   `outdated-registration`, or `unavailable`), and the app's previous search
   answers that request. An indexed search reflects every change committed
   before the search started. A write that commits while it runs may or may
   not appear, as with the scan.

5. **Safe processing.**
   - A drain claims a batch with a 60-second lease using
     `FOR UPDATE SKIP LOCKED`, so concurrent drains never process the same
     change, and a crashed drain's lease simply expires.
   - After indexing, a change is deleted only if its `seq` is unchanged, so a
     change recorded during processing is kept.
   - An index row is replaced only by a later change at the same or a newer
     version.
   - One failing resource holds back only itself:
     - when a batch fails, each of its changes is retried alone, so only the
       ones that fail back off;
     - a change that has failed before is always retried alone;
     - the backoff doubles, up to five minutes.
   - After five attempts a change is marked failed and logged, and search
     uses the fallback (`failed-changes`) until it succeeds. It keeps being
     retried, so a temporary failure clears itself. So do a new write to the
     resource and a rebuild.
   - If nothing the index stores has changed, the content hash skips the
     rewrite and only the newer `seq` is recorded.
6. **Rebuilds.** A higher registration `version` rebuilds the index:
   - The first process to see it raises the target version.
   - It enqueues every row with one `INSERT … SELECT`. That replaces changes
     already queued, including leased and failing ones, and it records the
     highest `seq` it assigned.
   - The rebuild is complete when nothing at or below that `seq` is pending.
     Rows whose source is gone are then removed.

   Every claim, index write, and completion carries a fence: it takes effect
   only while the target version is still the drain's own. A process on the
   older version can't consume or overwrite the rebuild, even if it was
   mid-batch when the version rose. It reports `outdated-registration` and
   uses its previous search.

   Versions only go up. Rolling back a deploy leaves search on the fallback
   until code at the index's version or higher runs again. To roll back a
   `load` change for good, ship the old `load` under a new, higher version.

7. **Reconciliation** (planned). A slow batched job compares `content_hash`
   with the source and requeues differences. Queue depth, queue age, and index
   lag are reported as metrics.

## Querying

Built: `indexedSearchSql({ registration, query, fields })` returns Drizzle SQL
that the app composes into its own statement: a join to `search_resources`, the
match condition, and the ranking terms. The app keeps its own access condition,
filters, snippets, parents, paging, and totals, all in the same statement.

Matching, for each term:

- **Titles and summaries** match by substring, including mid-word ("prio"
  finds "Task Priorities").
- **Bodies** match whole words through the GIN index, every word as a prefix.
  A multi-word term is a phrase whose last word is a prefix.
- **Fields.** A title, summary, and body share one position space, with a gap
  between them, so a phrase never spans two fields.
- **Positions.** Postgres keeps at most 255 positions per word and none past
  16,383. It also rejects a vector whose words alone take 1 MB. Core keeps a
  vector's estimated size under 900 KB: past that, it keeps one position per
  word, and then only the words that come first. A document past any of these
  limits has `positions_complete` false, and a phrase matches it when every
  word is present. Chunks will make that exact.

Ranking uses the tiers the browser lane uses: exact title 5, title prefix 4,
title word prefixes 3, title substrings 2, title or summary 1. Ties go to how
many query groups the title and then the summary cover, and then to whether
the body contains the whole query as a phrase. The app adds `updatedAt` and ID.

Content's parser moved to core, at `@agent-native/core/search-query`; Content
re-exports it. Its operators keep their meaning: phrases, `-term`, uppercase
`OR`, `intitle:`, and implicit AND, evaluated against the whole resource. The
`tsquery` is built from parsed words, so operator characters in user input
can't break it.

Planned, for the library call, in at most three round trips:

1. **Caller context:** validated org and group memberships, often already
   loaded by the request.
2. **The ranked page.** One statement over `search_resources`, joined to the
   source table. It filters by `app`, `type`, prefilters,
   `audience && caller tokens`, the access condition, and the match. It orders
   by the title tiers, then `ts_rank_cd` on `doc_vector` (if the relevance
   eval shows it helps), then personal signals as of the cursor's snapshot
   time (once views are recorded), then `updatedAt`, then ID. It returns
   `limit + 1` rows at the cursor's offset. For broad queries, passage ranking
   over chunks applies only to a deterministic top slice (for example, the
   first 200 by document rank), so pagination stays stable.
3. **Snippets and breadcrumbs** for the returned rows only. Each snippet reads
   `substring(source, start, end)` for the best chunk and verifies the chunk
   hash, falling back to the summary on a mismatch. Breadcrumbs come from
   authorized ancestors.

Cursors will encode the engine (fallback or index), `index_version`, offset,
and signal snapshot time. A cursor from one engine is rejected by the other,
and the search restarts.

The typo fallback will draw suggestions only from vocabulary the caller may
see. Vocabulary rows carry audience tokens, and "matched nothing" is decided
after authorization, so a suggestion can't reveal a word from a document the
caller can't open.

## Library and actions

Planned. Core will export:

- **`searchResources(options)`**: the library call described above, returning
  a `SearchPage`.
- **`createSearchAction(options)`**: a factory for a read-only action (`http`
  GET, `readOnly`, `mcpTool`), in a new `search` framework tool group.
- A per-app **`search`** action that fans out across the app's registered types
  with a `types` filter. The app's agent card advertises it and its schema, so
  A2A callers use one well-known name.

Apps with an existing contract keep their own action. Content keeps
`search-documents`; today it calls `prepareSearchIndex()` and
`indexedSearchSql()` directly. Its inputs (`exactTitle`, `excludeSubtreeOf`,
`searchFields`, offset paging) and outputs stay. Core registration never
overrides an app-defined action of the same name.

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

- **PGlite (local):** the lexical lane and triggers work. PGlite never gathers
  table statistics, so the feed's statements find rows by primary key rather
  than relying on the planner to pick a good join. The typo fallback will need
  `pg_trgm`, which core's PGlite client must pass at construction. There is no
  semantic lane; the action will report `semantic: "unavailable"`.
- **Neon:** `pg_trgm` and `vector` are created at release when those lanes
  land. Each search reads the index state and pending changes in its own
  round trip. That's short when the app runs in the database's region; from a
  distant client it was the whole latency difference from the previous
  engine. If it ever matters, the check can move into the search statement.
- **Serverless:** writes don't wait on indexing. A search processes what it
  can of a small backlog within its budget, and the sweep handler handles the
  rest.
- **Shared-database workspaces:** `app` and `resource_type` keep apps apart.
  The latency harness includes other tenants' rows.

## Testing

Built:

- **Core** (`packages/core/src/search/`), on real PGlite:
  - capture of inserts, updates, no-op updates, deletes, and rolled-back
    writes, including on a table with `json` and `point` columns;
  - distinct trigger names for every source;
  - a change recorded while its batch is processing is kept;
  - a claim never takes more than its limit;
  - backlog and rebuild readiness;
  - an older process can't consume a newer version's rebuild, whether it was
    already warm or mid-batch when the version rose;
  - one failing document holds back only itself and keeps search on the
    fallback until it succeeds;
  - a document with more distinct words than Postgres allows still indexes;
  - a search's budget bounds it, including when it joins a longer drain;
  - ranking tiers, mid-word titles against word-start bodies, camelCase,
    snake_case, URLs, Japanese, phrases in repetitive documents, phrases
    across fields, and the query operators.
- **Content:**
  - the relevance eval (`evals/search-relevance/`) with a recorded baseline;
  - a parity test that runs the same queries through the index and the
    fallback, which must agree except on mid-word body text;
  - the existing search suites, which run on the index path;
  - 10,000 documents on PGlite: the index builds in about 5 seconds, and warm
    search p95 is under 200 ms against a 400 ms budget.
  - 10,000 documents on Neon (PostgreSQL 17), in a table that also holds
    other tenants' rows, with the broad query words in every document. From a
    client outside the database's region, p95 over 180 searches per query class
    was 175–319 ms against the 400 ms budget, and 188–307 ms in a second
    180 after the review fixes. Server execution time matched the previous
    engine when every document matches (about 110 ms) and was 3 to 6 times
    lower for selective queries. The pending-changes check adds one round
    trip, so from that client broad queries took about 35–40 ms longer than
    before and selective ones about the same. Per batch of 30, though, the
    broadest query ("task prio") went over 400 ms in 3 of 12 batches, and the
    previous engine never did.
  - On the server, both engines' statements for that query occasionally
    stall: 2 to 3 of 200 executions ran over 200 ms, up to 475 ms for the
    previous engine and 715 ms for the index. The index's extra round trip
    leaves about 40 ms less headroom for a stall. Its statement looks up each
    match in `documents` by ID (60,000 buffer hits, against the previous
    engine's 11,000). A hash join that reads `documents` once took 81 ms,
    touched 3,700 buffers, and never ran over 200 ms in 200 executions, but
    Postgres doesn't choose it (open question 4).
  - Long bodies on Neon: 10,000 documents of 400 to 200,000 characters, with
    "task prio" three times in each body, from the same distant client. The
    index built in 57 seconds. Over 90 searches per query class, p50 / p95 was
    151–265 / 182–318 ms for the index and 212–310 / 237–374 ms for the
    previous engine, which scans every body. Per batch of 30, "task prio" went
    over 400 ms in 2 of 3 batches on the previous engine and in none on the
    index. Server time for the main statement fell from 57–133 ms to 4–79 ms.
    The index matched 6,667 bodies, not 10,000: in a third of them the phrase
    is spliced into a word ("wiltask prio"), and bodies match from word starts.

Planned:

- lifecycle tests for share, unshare, visibility, cross-space moves,
  hide-from-search on a subtree, and inline database deletion, once audience
  tokens land;
- AND and negation across chunks, and phrases across chunk boundaries;
- cursor stability and engine switches;
- runs on the Postgres service container;
- latency from a function in the database's region.

## Decisions made in revision 2

- **Trigger installation:** core exports the trigger SQL for a registration.
  Apps add it as a named migration: Content through `runMigrations` in
  `server/plugins/db.ts`. The startup check catches a missing trigger.
- **Caller orgs:** `callerOrgIds` defaults to the active org only. Content opts
  into its existing multi-org search.

## Decisions made in revision 3

- **Change capture is a general feed, not a search queue.** Other core
  features record changes in separate ways today. One coalescing feed with a
  consumer per feature lets later consumers reuse the same triggers. Whether
  every write should go through one core data layer is a separate decision.
- **Search never wakes a sleeping database.** There is no in-process interval;
  processing piggybacks on searches, writes, and the existing recurring tick.
- **Strict read-your-writes with a fallback,** instead of answering from an
  index that's partly behind. A change that keeps failing also holds search
  on the fallback, rather than letting the index answer without it.
- **The version is fenced in the database,** in each statement a drain runs,
  rather than trusted from what each process last saw.
- **Core tokenizes in JavaScript,** with no Postgres text-search configuration,
  so results don't depend on the database's locale.
- **Titles and summaries match by substring; bodies by word prefix.**
- **The first slice leaves out** audience tokens, chunks, `ts_rank_cd`, and
  cursors. The app's own statement enforces access, and Content keeps exact
  totals and offset paging.

## Open questions

1. Is a 100 ms drain budget enough to keep p95 at or under 400 ms on Neon after
   an import leaves a large backlog? Correctness doesn't depend on it, since a
   backlog falls back to the previous search. Search with nothing pending is
   measured; a backlog isn't yet. Indexing 12,000 documents took 45 to 65
   seconds from a distant client, where each batch of 50 costs about six
   round trips.
2. Does the recurring-jobs tick keep Netlify-hosted databases from ever
   suspending? It runs every minute and touches the database. Measure first;
   search's sweep handler only adds work to ticks that already run.
3. Does `ts_rank_cd` improve the relevance eval over the title tiers alone?
4. Can a query that matches nearly every document read `documents` once
   without slowing selective ones? Postgres picks the join from how many
   matches it expects, and it can't estimate substring or prefix matches: it
   expected about 3,000 of 12,000 rows to match "task prio" when all did.
   Turning off nested loops per statement would need a transaction per search
   and would make selective queries scan every document the caller can see.
