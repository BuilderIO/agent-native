---
"@agent-native/core": minor
---

Add server-side staging layer for provider-api responses.

- **Staging primitive (P0)**: `provider-api-request` now accepts `stageAs` to write response items into a scoped scratch dataset (`staged_datasets` + `staged_dataset_rows`) instead of returning the raw body. Returns `{ dataset, rowCount, columns, sampleRows }` — keeping large payloads out of the context window and avoiding the 50 K-char truncation that silently biases aggregates.

- **Paginated fetch-all (P1)**: Pass `pagination` alongside `stageAs` to fetch all pages server-side (cursor / page / offset modes). Handles 429 / Retry-After with exponential back-off. Caps at `maxPages` (default 50, up to 200) and returns `{ pages, rows, truncated, lastCursor }`.

- **New actions**: `query-staged-dataset` (in-process TypeScript aggregation — groupBy, sum/avg/count/min/max, where filters, orderBy/limit), `list-staged-datasets`, `delete-staged-dataset`. Portable across Postgres and SQLite — no dialect-specific JSON SQL.

- **Storage caps**: 200 K rows / 50 MB per app. Dataset ownership is scoped to `(app_id, owner_email)`.

- **Analytics template**: adds the three staging actions and updates `cross-source-analysis` + `provider-api` skills to teach the stage-then-aggregate flow.
