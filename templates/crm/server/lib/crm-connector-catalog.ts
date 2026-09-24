/**
 * Deliberately narrow authenticated MCP surface for CRM.
 *
 * External callers may read the access-scoped work overview, records and
 * their detail pages, lists and list entries, and follow-up tasks. Writes,
 * sync, enrichment, and provider requests remain available through the in-app
 * agent, ask_app, or an explicit full-catalog connection; tool-search alone
 * never makes them callable.
 */
export const CRM_CONNECTOR_CATALOG = [
  "get-crm-overview",
  "list-crm-records",
  "get-crm-record",
  "get-crm-record-page",
  "list-crm-lists",
  "list-crm-list-entries",
  "list-crm-tasks",
] as const;
