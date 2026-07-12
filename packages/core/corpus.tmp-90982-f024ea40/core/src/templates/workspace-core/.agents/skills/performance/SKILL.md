---
name: performance
description: >-
  Keep apps and templates loading fast. Read when adding a data model, a
  list/read action, a page or sidebar that loads data, or when something loads
  slowly. Covers column projection, indexing hot-path queries, avoiding N+1 and
  round-trip waterfalls, cheap polling, and not recomputing on every read.
scope: dev
metadata:
  internal: true
---

# Performance — Keep Loads Fast

## Rule

Treat every list, every read, and every page load as a latency budget. Two
things dominate it: **how much data crosses the wire**, and **how many
round-trips and table scans it takes**. On a hosted/serverless SQL backend each
query is a network round-trip, and an unindexed filter scans the whole — often
shared and growing — table. So default to **projected columns**, **indexed
hot-path queries**, and **parallel/batched** fetches. These rules are
provider-agnostic: they hold on SQLite, Postgres, or any managed SQL backend.

This skill is about the data and load path. See the `storing-data` skill for the schema
and migration mechanics it references, and the `real-time-sync` skill for how updates
already reach the UI without polling.

## 1. Project columns — never `SELECT *` on a list

A list/index query should select only the columns the list actually renders.

- **Never return heavy columns in a list**: large JSON/text blobs such as
  document bodies, rendered HTML, `config`/`layout`/`spec`/`data`/`tracks`,
  tool results, or base64 attachments. Pulling them for every row is the single
  most common cause of a slow list.
- Heavy/full columns belong on the **single-item GET/detail** path only.
- Need a preview from a big column? Select a **truncated substring at the DB**,
  not the whole column — and it stays portable:

  ```ts
  // Drizzle — project, and truncate the heavy column for the preview
  const rows = await db
    .select({
      id: docs.id,
      title: docs.title,
      updatedAt: docs.updatedAt,
      // substr/length work on both SQLite and Postgres
      preview: sql<string>`substr(${docs.content}, 1, 400)`,
    })
    .from(docs)
    .where(accessFilter(docs, docShares))
    .orderBy(desc(docs.updatedAt));
  ```

- After narrowing the projection, update the row mapper and its return type so a
  dropped column is provably unused on the list path. If the list genuinely
  renders a heavy column (a thumbnail, an inline preview the UI shows), keep it —
  don't break behavior to chase a payload win.

## 2. Index the hot paths

Indexes are added through the **versioned migration array** in
`server/plugins/db.ts` as `CREATE INDEX IF NOT EXISTS …` — not through a
schema-level `index()` helper (the framework applies indexes via migrations; see
the `storing-data` skill). Add an index for any column a hot query **filters or sorts**
on. The recurring ones:

- **Ownable tables** → `(owner_email, org_id, <the list's ORDER BY column>)`.
  Access scoping filters by owner/org and lists sort by `updated_at`/`created_at`.
- **Shares tables** (`{resource}_shares`) → `(resource_id, principal_type, principal_id)`.
  Access checks run correlated `EXISTS` subqueries against these on every list.
- **Child / foreign-key columns** used to load children (e.g. `responses.form_id`,
  `comments.parent_id`, an events log's `*_id`) → index the FK, plus its sort
  column when the children are ordered. An unindexed FK means a full scan of the
  child table on every parent open. **A foreign-key reference does not create an
  index automatically** — add it explicitly.
- **Status-filtered lists** → match the real `WHERE`, e.g. `(owner_email, status)`
  or `(status, <sort>)`.

Keep index DDL **dialect-agnostic and idempotent**:

```sql
CREATE INDEX IF NOT EXISTS forms_owner_org_updated_idx ON forms (owner_email, org_id, updated_at)
```

No `DESC`, no partial `WHERE`, no provider-specific syntax — it then runs on
SQLite and Postgres alike, is safe to re-run, and applies on next startup.
Indexes mostly bite **as data grows** and on **unbounded child tables** (a
seq-scan of 10 rows is instant; of a shared, ever-growing log it is not), so
index the growing tables first.

## 3. Don't fan out queries — batch and parallelize

- **No N+1.** Never loop issuing one query per item. Load children for many
  parents in one `inArray(child.parentId, ids)` query, then group in memory.
- **Count in SQL** (`count()`), never "select all rows then `.length`".
- **Parallelize independent queries** with `Promise.all` rather than sequential
  `await`s — each `await` is another round-trip.
- Prefer **one composed endpoint** over several dependent calls.

## 4. Avoid client-side waterfalls

- Don't gate query B on query A's result unless B truly needs it. Fire
  independent `useActionQuery` / `useQuery` hooks **in parallel**; never make the
  loading skeleton wait on a serial chain.
- Load the visible page from one read where possible, and **lazy-load**
  secondary / below-the-fold data after first paint.

## 5. Poll cheaply; compute once

- Updates already reach the UI through the `real-time-sync` skill (`useDbSync` / SSE).
  Don't add an aggressive `refetchInterval` that re-runs a heavy list/read every
  couple of seconds. If you must poll, use a **wide interval** and a **cheap**
  endpoint.
- **Never do expensive per-request work on a read that runs on every load/poll**:
  re-rendering HTML/markdown, pretty-printing, re-parsing / migrating /
  normalizing / sanitizing stored JSON. Do that work at **write time** (store the
  result) or compute it **lazily only for the caller that needs it**. Reads on
  the hot path must be cheap.
- Data the UI doesn't display (export formats, alternate renderings) belongs in a
  separate on-demand action, not baked into the hot read.

## 6. Big payloads and long lists

- **Paginate or window** unbounded lists (messages, responses, events, activity).
  Don't load the entire history on open; load a recent window and fetch older on
  demand.
- Don't store **unbounded blobs inline** in a row that a list/load pulls.
  Reference large content separately so opening the parent stays cheap.
- Never inline binary payloads in columns a list, poll, or `view-screen` summary
  reads. Images, PDFs, audio/video, archives, screenshots, and base64
  attachments belong in file/blob storage; SQL rows should hold URLs, asset ids,
  storage keys, or opaque blob refs.
- **Virtualize** very long rendered lists on the client so off-screen rows aren't
  parsed/rendered every update.

## Checklist — run before shipping a list/read or a new table

- [ ] List selects only displayed columns; heavy blobs excluded or `substr`-truncated.
- [ ] Every hot-path `WHERE` / `ORDER BY` column is indexed (owner/org/sort,
      shares `resource_id`, child FKs, status filters) via a `db.ts` migration.
- [ ] No N+1; independent queries parallelized; counts via SQL `count()`.
- [ ] Client fires independent queries in parallel, not a waterfall.
- [ ] No heavy recompute on every read; no aggressive polling of heavy endpoints.
- [ ] Unbounded lists are paginated/windowed; large blobs aren't inlined on the hot path.
