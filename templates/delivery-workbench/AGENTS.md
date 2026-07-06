# Delivery Workbench

Delivery Workbench owns canonical delivery work items, routing rules, and
queue/detail context. Use its actions as the single source of truth for work
item data; do not add REST wrappers for queue CRUD.

## UI

- `/queue` is the queue workbench. Filters live in URL search params:
  `status`, `priority`, `provider`, `assignee`, `tag`, and `q`.
- `/work-items/:id` opens the same queue shell with a detail/source panel for
  the selected work item.
- UI reads use `useActionQuery`; writes use `useActionMutation` against
  `update-work-item`.
- The source panel intentionally shows upstream identifiers, source URL,
  snapshot hashes, and ingest timing only. Do not expose raw source payloads in
  the UI.

## Actions

- `ingest-work-items` — canonical bulk write entrypoint. Pass normalized items
  from an upstream sync in one call; it upserts by `(provider, sourceId)`,
  records source snapshots and ingest run stats, and is idempotent for the same
  dataset.
- `list-work-items` — GET list action for queue views. Supports status,
  priority, provider, assignee, tag, search, and limit filters.
- `get-work-item` — GET detail action for one work item.
- `update-work-item` — patch status, priority, assignee, tags, due date,
  title, body, and metadata for an existing accessible work item.
- `list-routing-rules` — GET action for supervisor routing rules.
- `upsert-routing-rule` — create or update a routing rule.
- `view-screen` — returns the current queue/detail state from application
  state, URL filters, and canonical rows.
- `navigate` — writes a one-shot app-state navigation command for queue or
  detail views.

## Boundaries

- `owner_email`, `org_id`, and `visibility` are access-control fields.
  Delivery responsibility belongs in `assignee_email`, `team_id`, or routing
  suggestions, never in `owner_email`.
- Provider-specific sync and cursors belong in `delivery-sync`. Workbench only
  stores normalized canonical rows and auditable ingest/snapshot data.
