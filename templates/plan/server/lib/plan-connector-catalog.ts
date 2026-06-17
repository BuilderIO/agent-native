/**
 * Curated connector catalog for hosted multi-tenant Plan deployments.
 *
 * External coding agents (Claude Code, Codex, Cursor, etc.) connecting via MCP
 * see only these tools plus the builtin cross-app tools (list_apps, open_app,
 * ask_app, create_embed_session). Tools outside this list are not callable.
 *
 * Callers who need every action registered by this Plan MCP mount can opt up
 * with `agent-native connect --full-catalog`. That bypasses this curated
 * catalog tier, but it still does not add generic framework/dev/local tools
 * that this hosted Plan MCP server intentionally never mounts.
 *
 * EXCLUDED intentionally:
 *   - seed-kitchen-sink, seed-vertical-tabs  (destructive demo scripts)
 *   - get-local-plan-folder                  (filesystem path, not useful remotely)
 *   - context-manifest-get/pin/evict/restore/report  (context-xray internals)
 *   - visualize-plan                         (internal alias, superseded)
 */
export const PLAN_CONNECTOR_CATALOG: string[] = [
  // Plan CRUD
  "create-visual-plan",
  "create-ui-plan",
  "create-prototype-plan",
  "create-plan-design",
  "create-visual-questions",
  "create-visual-recap",
  "get-visual-plan",
  "list-visual-plans",
  "update-visual-plan",
  "get-plan-blocks",
  "get-plan-feedback",
  "consume-plan-feedback",
  "reply-to-plan-comment",
  "resolve-plan-comment",
  "delete-plan-comment",
  // Plan versioning
  "list-plan-versions",
  "get-plan-version",
  "restore-plan-version",
  // Plan source / export
  "read-visual-plan-source",
  "export-visual-plan",
  "import-visual-plan-source",
  "patch-visual-plan-source",
  // Plan publish & convert
  "publish-visual-plan",
  "convert-visual-plan-to-prototype",
  // Record recap
  "record-recap-usage",
  // Sharing
  "set-resource-visibility",
  "share-resource",
  "unshare-resource",
  "list-resource-shares",
  // Media
  "upload-image",
  // Navigation & screen
  "navigate",
  "view-screen",
  // Automations (users configure plan event notifications from external agents)
  "manage-automations",
  // Tool discovery
  "tool-search",
];
