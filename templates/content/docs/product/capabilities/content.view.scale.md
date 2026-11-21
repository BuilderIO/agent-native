---
record_type: "capability"
spec_version: 2
id: "content.view.scale"
name: "Large Collection performance"
user_promise: "Collections stay responsive and incrementally queryable well beyond a few hundred rows"
primary_user_job: "Find, change, and navigate a large authorized collection without waiting for every row to arrive or trusting an incomplete result as final."
kind: "surface"
state: "failing"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query"]
related_features: ["content.feature.see-your-information-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "Views use server-side typed queries, bounded windows and aggregates, indexes, explicit partial states, and measured interaction budgets for large authorized collections."
proof_requirements:
  [
    "Server-side filter, sort, pagination/window, index, cursor, and bounded-aggregate coverage",
    "Partial-result, mutation, refresh, access-change, and unavailable-source correctness tests",
    "Real-interface performance traces for representative large collections and renderer interactions",
  ]
evidence:
  [
    "../../../actions/content-database-lifecycle.db.test.ts",
    "../../../actions/content-database-list-read.db.test.ts",
    "../../../actions/get-page-open-read.db.test.ts",
    "../../../shared/database-query.test.ts",
    "../../../app/components/editor/database/DatabaseView.error-toasts.test.tsx",
    "../../../scripts/seed-perf-database.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-11-11"
---

# Large Collection performance

## Why this exists

A View that feels quick only while its collection is small has not yet earned the word
View. Scale must preserve both responsiveness and truthful result boundaries.

## Example workflow

An editor filters a large Collection, scrolls to another window, edits a visible record,
and refreshes after another editor changes the result. The interface identifies partial
loading and does not count unseen rows as if it had completed the query.

## Product contract

- Filtering, sorting, access evaluation, pagination, and aggregates execute against bounded typed results.
- Windows, cursors, counts, totals, and loading state state whether results are complete, partial, stale, or unavailable.
- Mutations reconcile with canonical results and do not silently retain a record that no longer matches.
- Performance work preserves renderer conformance, accessible navigation, and Action parity.

## Boundaries and non-goals

Query execution owns collection semantics. This Capability is not a client-side cache
excuse, a permission shortcut, or a promise of unbounded instant export.

## Acceptance stories

### Navigate a partial result honestly

Given a large authorized result, when a viewer opens and scrolls it, then they can
navigate incremental windows and distinguish loaded rows and totals from incomplete work.

### Reconcile a changing collection

Given a visible record changed to no longer match a filter, when the Action succeeds,
then the View removes or repositions it truthfully without stale duplicate rows.

## Current evidence

Large tables have improved a lot since the last review, but the promise still fails
outside the plain table path, so this Capability remains `failing`.

What the repository proves today:

- Tables read 100 rows at a time behind a "Load more rows" control that shows the
  loaded count against the total, so a partly loaded table says it is partial.
- Table search, filters, and sorts run on the server and return one 100-row page,
  except on fields from a secondary Source. The rows already on screen stay visible
  while a new sort or filter loads.
- Collection reads share property, source-field, and rollup reads, send each property
  definition once instead of with every row, and leave page bodies out of list rows.
- Opening a Collection's page reads its first 100 rows with the page itself.
- Table rows are memoized, so a live agent write or a filter change redraws only the
  rows whose data changed.
- A seeding script builds large test Collections, and a startup trace measures page
  loads on large workspaces.

Measured so far: one-off local runs in August 2026 on seeded Collections. A 5,000-row
table showed its first 100 rows in under 200 ms warm and re-sorted in under 300 ms
with its rows kept on screen; 584- and 1,000-row tables opened in about 210 ms. Those
runs used working budgets of first useful rows within 1 second warm or 2 seconds
cold, a sort within 500 ms warm or 1 second cold, and gesture feedback within 100 ms.
They are not a repeatable check, and hosted acceptance of that workload was not
completed.

What still fails:

- Table search, filters, and sorts read at most 5,000 rows and evaluate them in
  application code, not through indexed queries. On a larger Collection, a filtered
  or sorted table read fails with an error naming the 5,000-row limit.
- Calendar and timeline Views, and any filtered or grouped View that is not a table,
  load up to 5,000 rows into the browser.
- No View windows its rendering: every loaded row is drawn, so each "Load more rows"
  adds to the drawn rows.
- Column calculations run in the browser over the rows loaded so far. On a partly
  loaded Collection they describe those rows, not the whole result.
- Neither the correctness tests nor the real-interface traces in the proof plan run
  as a repeatable suite.

## Proof plan

1. Benchmark indexed filters, sorts, cursors, windows, and bounded aggregates at representative sizes.
2. Test partial, stale, access-changing, unavailable, and mutation-reconciliation states.
3. Capture real UI traces for initial load, navigation, edit, refresh, and accessible keyboard use.

## Open questions

The working budgets above came from one large-table workload. Whether they become this
Capability's acceptance budgets, and which Collection sizes beyond 5,000 rows the
promise covers, still need agreement before a verified claim.
