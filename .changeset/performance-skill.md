---
"@agent-native/core": patch
---

Add a `performance` agent skill (DB-provider-agnostic) covering the load-speed
best practices apps and templates should follow: project columns on list
endpoints (never `SELECT *` heavy blobs), index hot-path queries
(`owner_email`/`org_id`/sort, `*_shares.resource_id`, child foreign keys, status
filters) via the versioned migration array, avoid N+1 and round-trip waterfalls,
poll cheaply, don't recompute on every read, and paginate unbounded lists. The
skill ships into generated workspaces via `workspace-core` and is cross-linked
from `storing-data`.
