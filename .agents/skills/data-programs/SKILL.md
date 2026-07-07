---
name: data-programs
description: >-
  Save a run-code fetch/join/aggregate script as a stored, refreshable data
  source any app's own charts/tables can render, instead of a hardcoded
  provider action or a per-view re-fetch. Use when an ad-hoc run-code or
  provider-api-request analysis should become a live, cached data source other
  users or panels can reuse.
---

# Data Programs

A **data program** is a named, stored, agent-authored JS script that fetches,
joins, filters, or aggregates data — provider APIs via `providerFetch` /
`providerFetchAll` / `providerSearchAll`, app data via `appAction`, or
Resources-backed workspace files — and emits a small `{ rows, schema }`
result that gets cached in SQL. Any app can render that result through its
own table/chart components; nothing about the primitive is analytics-specific.

This ships automatically wherever `run-code` is available — there is nothing
to mount, wire, or configure per app. If your app already has run-code
enabled, `save-data-program` / `preview-data-program` / `run-data-program` /
`list-data-programs` / `get-data-program` / `delete-data-program` are already
registered actions.

## Why this exists

Without it, "build a live view of X" tends to end in one of two bad places:
a hardcoded action per vendor/query shape (brittle, doesn't scale to every
customer's custom fields), or re-running the same fetch/join logic from
scratch on every page view (slow, and it re-spends the same provider quota
every time someone looks at a chart). A data program is the middle ground:
write the fetch/join/aggregate logic once as ordinary `run-code`, save it, and
let the cache + refresh policy handle "how often does this actually need to
re-run."

## Authoring workflow

1. Prototype the fetch/join/aggregate logic as a normal `run-code` script and
   confirm it returns the rows you expect.
2. Change it to call `emit(rows, schema?)` exactly once at the end instead of
   returning or printing the result.
3. Save it with `save-data-program({ name, title, description, code,
   defaultParams?, refreshMode?, refreshTtlMs?, background? })`. This
   **dry-runs the code with `defaultParams` before persisting** and rejects
   the save with a structured error if it fails, so a broken program is never
   stored. On success it returns `{ programId, rowCount, columns,
   sampleRows }` — use that as proof the program produces the rows you
   expect.
4. Bind whatever UI needs the result. Your app's own read path calls
   `run-data-program({ programId, params?, forceRefresh?, includeRows? })`
   and gets back rows/schema/cache metadata to hand to your own table/chart
   components — there is no dashboard-specific plumbing baked into the
   primitive itself. (The analytics template's `"program"` dashboard panel
   source is one such adoption, not a required pattern — see its
   `data-programs` skill if you want a concrete UI wiring reference.)
5. Iterate without persisting via `preview-data-program({ code, params? })` —
   same dry-run path, no stored row.

## The sandbox surface

Exactly the `run-code` globals (`providerFetch`, `providerFetchAll`,
`providerSearchAll`, `appAction`, `webFetch`, `workspace*` Resources helpers),
plus:

- `params` — a **frozen** global object holding the params for this run.
  Read-only; mutating it throws.
- `emit(rows, schema?)` — call exactly once, at the end. `rows` must be an
  array of plain objects. `schema`, when provided, is
  `{ name: string, type: string }[]`; when omitted it's inferred from the
  first 50 rows (a column is `"json"` if rows disagree on primitive type,
  otherwise `"number"` / `"string"` / `"boolean"`). `console.log` remains free
  for debugging and never interferes with parsing the emitted result.

Caps enforced on every run:

| Limit | Value |
| --- | --- |
| Max emitted rows | 10,000 (excess dropped, `truncated: true`) |
| Max emitted result size | 4 MiB (rows dropped from the end to fit; a single oversized row is a hard failure) |
| Max active programs per app | 200 |
| Minimum refresh TTL | 60,000 ms |
| Run rows kept per (program, params) | 5 most recent |

Truncation is always explicit (`truncated: true`) — never a silent drop.

## Caching and refresh model

Every `(programId, paramsHash)` pair has its own run history:

| Situation | Behavior |
| --- | --- |
| Fresh cache (younger than `refreshTtlMs`, or `refreshMode: "manual"` with a prior success) | Returns cached rows instantly, `cacheHit: true` |
| Stale cache | Re-executes synchronously (25s budget for view-triggered reads, 120s for agent/manual calls), replacing the cache on success |
| `refreshMode: "manual"` | Only refreshes on explicit `forceRefresh: true` |
| No cache yet | Executes synchronously like a normal first fetch |
| `background: true` program with no fresh cache | Serves the last good run with `stale: true` and enqueues a durable background execution; a later call finalizes it once complete |
| Background program still running, no prior success | `background_pending` failure — surface an explicit "still computing" state, never a blank result |
| Execution fails | Structured `{ code, message }` failure; a previous success is attached as `lastGoodRun` for stale-serve |
| Program archived (soft-deleted) | Explicit `archived` failure |

Use `background: true` only for scripts that routinely exceed the foreground
timeout (large multi-provider joins, deep pagination). Everything else should
stay foreground.

## Security notes

- **Credentials are always the calling viewer's, never the program author's.**
  `providerFetch` inside a program resolves auth using the caller's own
  request context. A viewer without a configured provider key sees that
  provider's normal auth error on that program's result — never another
  user's data.
- **Programs are shareable org-internal only — never public.** Sharing a
  program means teammates can view its cached result; because execution uses
  the *viewer's* credentials, only bind to or view a program you trust.
- Raw provider tokens never reach the model or the browser. Only the
  `{ rows, schema }` an `emit()` call produces ever leaves the sandbox.
- The mutating/executing actions (`save-data-program`, `preview-data-program`,
  `run-data-program`, `delete-data-program`) are not callable from a
  sandboxed extension/iframe bridge — only from the agent or a server-side
  read path.

## Related skills

- `actions` for `run-code` conventions and the sandbox globals this primitive
  is built on.
- `sharing` for the org-internal, never-public sharing model programs use.
- `security` for credential-handling and access-scoping invariants.
