/**
 * Deliberately narrow authenticated MCP surface for CRM.
 *
 * External callers may read access-scoped records and their detail pages,
 * lists and list entries, and follow-up tasks. Writes, sync, enrichment, and
 * provider requests remain available through the in-app agent, ask_app, or an
 * explicit full-catalog connection; tool-search alone never makes them
 * callable.
 *
 * `get-crm-overview` is deliberately excluded: it reads through the legacy
 * `listCrmRecords` path in server/db/crm-store.ts, which resolves provider
 * scope without the caller's identity (no `ActionRunContext`). A resolver
 * failure there becomes a partial success instead of a caller-scoped read, so
 * it stays off the external catalog until that path takes a context.
 */
export const CRM_CONNECTOR_CATALOG = [
  "list-crm-records",
  "get-crm-record",
  "get-crm-record-page",
  "list-crm-lists",
  "list-crm-list-entries",
  "list-crm-tasks",
] as const;
