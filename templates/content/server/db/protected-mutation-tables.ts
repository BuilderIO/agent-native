import { registerProtectedMutationTables } from "@agent-native/core/db";

export const CONTENT_PROTECTED_MUTATION_TABLES = [
  "documents",
  "document_versions",
  "document_preview_drafts",
  "document_comments",
  "document_shares",
  "document_sync_links",
  "builder_doc_sidecars",
  "document_property_definitions",
  "document_property_values",
  "document_block_field_contents",
  "content_spaces",
  "content_space_catalog_items",
  "content_databases",
  "content_database_items",
  "content_database_body_hydration_queue",
  "content_database_sources",
  "content_database_source_fields",
  "content_database_source_rows",
  "content_database_source_change_sets",
  "content_database_source_change_reviews",
  "content_database_source_executions",
  "content_database_source_execution_claims",
  "content_notification_preferences",
  "workflow_events",
  "workflow_subscriptions",
  "workflow_subscription_versions",
  "workflow_executions",
  "workflow_scheduled_work",
  "workflow_effects",
  "notification_delivery_attempts",
] as const;

let registered = false;

export function registerContentProtectedMutationTables(): void {
  if (registered) return;
  registerProtectedMutationTables({
    tables: CONTENT_PROTECTED_MUTATION_TABLES,
    guidance:
      "Use the corresponding Content action so access checks, collaboration state, and the actor-aware committed-change envelope remain atomic.",
  });
  registered = true;
}
