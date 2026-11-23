---
name: performance
description: >-
  Keep app loads and interactions responsive as data grows. Use when a page
  feels slow, jumps, or lags, or when changing a data read, list, polling path,
  startup path, or performance-sensitive UI.
scope: dev
---

# Performance

Find the cost that users actually wait on, then reduce it without weakening
the result. A slow screen may be waiting on the server, moving too much data,
serial reads, repeated computation, or browser rendering; measure before adding
caches or extra complexity.

## Load only what the current view needs

- Shape list reads around the fields the list displays. Keep large document
  bodies, histories, rendered output, and other rarely viewed data on a detail
  or on-demand path. Return a small preview when the list needs one.
- Paginate or window unbounded histories and activity feeds. Start with the
  recent or visible range and load more as the user asks for it.
- Batch related reads instead of issuing one query per row. Compute counts and
  other aggregates in the database when the result can be much smaller than
  the source rows.
- Start independent reads together. Do not make the first useful content wait
  for unrelated settings, below-the-fold panels, or secondary details.
- Index fields used by frequent filters, joins, and sorts when the data and
  observed query cost justify it. Keep indexes aligned with real query shapes.

For action-backed screens, shape the action response for the screen's current
need and keep the UI on the app's existing action and query hooks. Do not add a
second fetch path that duplicates the same read.

## Keep repeated work cheap

- Keep list and frequently refreshed reads inexpensive. Avoid parsing,
  reformatting, or rebuilding large values on every read when the result can be
  prepared once or computed only for the view that needs it.
- Use the app's existing live-update path when fresh data must reach an open
  screen. Poll only when needed, and keep polled reads bounded and cheap.
- Keep large file contents and long records out of list responses. Load them
  when the user opens the relevant item rather than sending them on every list
  refresh.
- Defer nonessential data and expensive child views until after the main
  content is usable. Window a rendered list when rendering all rows makes
  scrolling or updates slow.

## Protect startup and the first paint

- Keep migrations, backfills, data scans, aggregations, provider handshakes,
  and cache warming out of module evaluation and application startup. Hosted
  serverless instances can restart, so startup work can repeat on user
  requests. Use the app's deliberate migration, job, or on-demand path.
- Keep optional heavy runtimes out of modules loaded by ordinary page requests.
  Load a browser, media processor, or other large dependency only in the
  feature or job that needs it, and inspect the deployed bundle when adding
  one.
- Keep the server-rendered shell public and independent of a visitor's session.
  Resolve user-specific state after the shell loads through the app's
  authenticated client data path. Reads that must reflect a recent mutation
  should not depend on cached server-rendered loader data.
- Give loading placeholders the final content's basic geometry. Reserve space
  for content whose size is known; avoid showing a temporary layout that shifts
  the user's reading position when data arrives.

## Keep interactions responsive

Show that an interaction registered as soon as it happens, aiming for 100 ms.
If the work needs the network or takes longer, acknowledge it before waiting
and show a focused pending state within 400 ms. Use an optimistic update when
it is safe, then confirm or roll back on failure.

When investigating a slow experience, separate server response time, data
transfer, serial waits, rendering, layout movement, and long interaction work.
Use representative data and the production build when development tooling
changes the cost. Verify that the user-visible action completed before
comparing timings or memory.
