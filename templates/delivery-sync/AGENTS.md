# Delivery Sync

Delivery Sync owns upstream provider sync cursors, raw/archive references, and
provider-facing contracts. It does not own queue UI reads; normalized work items
are written through Delivery Workbench `ingest-work-items`.

## Actions

- `sync-source` — accepts a provider and cursor/window plus already-normalized
  items for the P1 skeleton, records the sync cursor, then calls the workbench
  ingest library in one batch. Provider adapters can replace the normalization
  step later without changing the workbench contract.
- `reconcile-source` — contract placeholder for future provider reconciliation.
  It records the requested provider/window and returns the current gap rather
  than adding REST wrappers.
- `list-source-cursors` — GET action that lists known provider cursors.

## Current P1 Gaps

The provider API trio is not fully mounted in this P1 skeleton. Until that is
completed, provider-specific adapters should normalize into `sync-source.items`
and keep raw provider payloads outside chat as `rawRef` artifacts.
