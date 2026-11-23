import { runMigrations, type MigrationEntry } from "@agent-native/core/db";

/**
 * Status labels are an organisation catalogue. Before moving uniqueness from
 * (author, name) to (organisation, name), existing rows that collide inside an
 * organisation are renamed deterministically. No row is deleted and the author
 * metadata (`owner_email`) is untouched.
 */
export const ANALYTICS_STATUS_ORG_DEDUPE_SQL = `
  DO $$
  DECLARE
    duplicate RECORD;
    candidate TEXT;
    suffix INTEGER;
  BEGIN
    FOR duplicate IN
      SELECT id, name, org_id
      FROM (
        SELECT id, name, org_id,
               row_number() OVER (
                 PARTITION BY org_id, name
                 ORDER BY created_at, id
               ) AS position
        FROM "analytics2_statuses"
        WHERE org_id IS NOT NULL
      ) ranked
      WHERE ranked.position > 1
    LOOP
      suffix := 1;
      LOOP
        candidate := duplicate.name || ' (' || (suffix + 1) || ')';
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM "analytics2_statuses"
          WHERE org_id = duplicate.org_id
            AND name = candidate
            AND id <> duplicate.id
        );
        suffix := suffix + 1;
      END LOOP;
      UPDATE "analytics2_statuses"
      SET name = candidate
      WHERE id = duplicate.id;
    END LOOP;
  END
  $$;
`;

/**
 * App-owned migrations for the analytics workspace. They are additive only:
 * new tables, new columns and new indexes, never a dropped one. The one
 * replaced index below carries no data; the catalogue rows are preserved.
 */
export const analyticsMigrations: MigrationEntry[] = [
  {
    version: 1,
    name: "analytics2-projects-and-cells",
    sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_projects" (
        "owner_email" text NOT NULL DEFAULT 'local@localhost',
        "org_id" text,
        "visibility" text NOT NULL DEFAULT 'private',
        "id" text PRIMARY KEY,
        "title" text NOT NULL DEFAULT '',
        "description" text NOT NULL DEFAULT '',
        "language" text NOT NULL DEFAULT 'python' CHECK ("language" IN ('python', 'r')),
        "status_id" text,
        "favorited" boolean NOT NULL DEFAULT false,
        "trashed_at" text,
        "archived_at" text,
        "last_opened_at" text,
        "working_version_id" text NOT NULL,
        "published_version_id" text,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "analytics2_projects_owner_updated_idx"
        ON "analytics2_projects" ("owner_email", "updated_at");
      CREATE INDEX IF NOT EXISTS "analytics2_projects_owner_trashed_idx"
        ON "analytics2_projects" ("owner_email", "trashed_at");
      CREATE INDEX IF NOT EXISTS "analytics2_projects_working_version_idx"
        ON "analytics2_projects" ("working_version_id");

      CREATE TABLE IF NOT EXISTS "analytics2_project_versions" (
        "id" text PRIMARY KEY,
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "number" text NOT NULL,
        "kind" text NOT NULL DEFAULT 'autosave' CHECK ("kind" IN ('autosave', 'published', 'named')),
        "name" text,
        "created_at" text NOT NULL,
        "created_by" text NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_project_versions_number_uq"
        ON "analytics2_project_versions" ("project_id", "number");
      CREATE INDEX IF NOT EXISTS "analytics2_project_versions_project_created_idx"
        ON "analytics2_project_versions" ("project_id", "created_at");

      CREATE TABLE IF NOT EXISTS "analytics2_cells" (
        "id" text NOT NULL,
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "version_id" text NOT NULL,
        "kind" text NOT NULL,
        "order" text NOT NULL DEFAULT '',
        "label" text,
        "hidden" boolean NOT NULL DEFAULT false,
        "grid_x" integer,
        "grid_y" integer,
        "grid_width" integer,
        "grid_height" integer,
        "contents" text NOT NULL DEFAULT '{}',
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_cells_version_id_uq"
        ON "analytics2_cells" ("version_id", "id");
      CREATE INDEX IF NOT EXISTS "analytics2_cells_version_order_idx"
        ON "analytics2_cells" ("version_id", "order");
      CREATE INDEX IF NOT EXISTS "analytics2_cells_project_idx"
        ON "analytics2_cells" ("project_id");
    `,
  },
  {
    version: 2,
    name: "analytics2-collections-and-statuses",
    sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_collections" (
        "owner_email" text NOT NULL DEFAULT 'local@localhost',
        "org_id" text,
        "visibility" text NOT NULL DEFAULT 'private',
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "kind" text NOT NULL DEFAULT 'collection' CHECK ("kind" IN ('collection', 'folder')),
        "parent_id" text,
        "favorited" boolean NOT NULL DEFAULT false,
        "trashed_at" text,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "analytics2_collections_owner_parent_idx"
        ON "analytics2_collections" ("owner_email", "parent_id");
      CREATE INDEX IF NOT EXISTS "analytics2_collections_owner_updated_idx"
        ON "analytics2_collections" ("owner_email", "updated_at");

      CREATE TABLE IF NOT EXISTS "analytics2_project_collections" (
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "collection_id" text NOT NULL REFERENCES "analytics2_collections" ("id") ON DELETE CASCADE,
        "added_at" text NOT NULL,
        PRIMARY KEY ("project_id", "collection_id")
      );
      CREATE INDEX IF NOT EXISTS "analytics2_project_collections_collection_idx"
        ON "analytics2_project_collections" ("collection_id");

      CREATE TABLE IF NOT EXISTS "analytics2_statuses" (
        "owner_email" text NOT NULL DEFAULT 'local@localhost',
        "org_id" text,
        "visibility" text NOT NULL DEFAULT 'private',
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "color" text,
        "endorsed" boolean NOT NULL DEFAULT false,
        "in_library" boolean NOT NULL DEFAULT false,
        "enforces_review" boolean NOT NULL DEFAULT false,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_statuses_owner_name_uq"
        ON "analytics2_statuses" ("owner_email", "name");
    `,
  },
  {
    version: 3,
    name: "analytics2-runs-and-outputs",
    sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_runs" (
        "id" text PRIMARY KEY,
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "cell_id" text NOT NULL,
        "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'running', 'complete', 'error', 'cancelled')),
        "started_at" text NOT NULL,
        "finished_at" text,
        "duration_ms" bigint,
        "output" text
      );
      CREATE INDEX IF NOT EXISTS "analytics2_runs_project_started_idx"
        ON "analytics2_runs" ("project_id", "started_at");
      CREATE INDEX IF NOT EXISTS "analytics2_runs_cell_started_idx"
        ON "analytics2_runs" ("cell_id", "started_at");

      CREATE TABLE IF NOT EXISTS "analytics2_cell_outputs" (
        "cell_id" text PRIMARY KEY,
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "run_id" text,
        "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'running', 'complete', 'error', 'cancelled')),
        "output" text,
        "ran_at" text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "analytics2_cell_outputs_project_idx"
        ON "analytics2_cell_outputs" ("project_id");
    `,
  },
  {
    version: 4,
    name: "analytics2-org-scoped-pages",
    sql: `
      CREATE INDEX IF NOT EXISTS "analytics2_projects_scope_page_idx"
        ON "analytics2_projects" ("owner_email", "org_id", "updated_at", "id");
      CREATE INDEX IF NOT EXISTS "analytics2_collections_scope_parent_idx"
        ON "analytics2_collections" ("owner_email", "org_id", "parent_id");
      CREATE INDEX IF NOT EXISTS "analytics2_statuses_scope_order_idx"
        ON "analytics2_statuses" ("owner_email", "org_id", "sort_order");
    `,
  },
  {
    version: 5,
    name: "analytics2-org-status-catalog",
    sql: `
      DROP INDEX IF EXISTS "analytics2_statuses_owner_name_uq";
      ${ANALYTICS_STATUS_ORG_DEDUPE_SQL}
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_statuses_org_name_uq"
        ON "analytics2_statuses" ("org_id", "name");
    `,
  },
  {
    version: 6,
    name: "analytics2-output-connection-provenance",
    sql: `
      ALTER TABLE "analytics2_cell_outputs" ADD COLUMN IF NOT EXISTS "source_connection_id" text;
      ALTER TABLE "analytics2_cell_outputs" ADD COLUMN IF NOT EXISTS "connection_provenance_recorded" boolean NOT NULL DEFAULT false;
    `,
  },
  {
    version: 7,
    name: "analytics2-dbt-query-operations",
    sql: `CREATE TABLE IF NOT EXISTS "analytics2_dbt_query_operations" (
      "id" text PRIMARY KEY,
      "owner_email" text NOT NULL,
      "org_id" text NOT NULL,
      "value" text NOT NULL
    );`,
  },
  {
    version: 8,
    name: "analytics2-project-categories",
    sql: `CREATE TABLE IF NOT EXISTS "analytics2_project_categories" (
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "category_id" text NOT NULL,
      "added_at" text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_project_categories_uq"
      ON "analytics2_project_categories" ("project_id", "category_id");
    CREATE INDEX IF NOT EXISTS "analytics2_project_categories_category_idx"
      ON "analytics2_project_categories" ("category_id");`,
  },
  {
    version: 9,
    name: "analytics2-project-views",
    // One row per project open. It is keyed by the viewer so "popular" can count
    // distinct viewers rather than raw opens, and it is never a source of truth
    // for a project: deleting a project removes its views with it.
    sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_project_views" (
        "id" text PRIMARY KEY,
        "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "viewer_email" text NOT NULL,
        "org_id" text,
        "viewed_at" text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "analytics2_project_views_project_idx"
        ON "analytics2_project_views" ("project_id", "viewed_at");
      CREATE INDEX IF NOT EXISTS "analytics2_project_views_viewer_idx"
        ON "analytics2_project_views" ("viewer_email", "viewed_at");
    `,
  },
];

// A component is a named snapshot of cells taken from one project, importable
// into another (the source makes it a first-class object: CellType.COMPONENT_IMPORT
// and the create-from-selection flow). The snapshot is stored as JSON so an
// import renders exactly what was captured, not whatever the source project
// looks like later.
analyticsMigrations.push({
  version: 10,
  name: "analytics2-components",
  sql: `
    CREATE TABLE IF NOT EXISTS "analytics2_components" (
      "id" text PRIMARY KEY,
      "owner_email" text NOT NULL,
      "org_id" text NOT NULL,
      "source_project_id" text NOT NULL,
      "name" text NOT NULL,
      "normalized_name" text NOT NULL,
      "cells_json" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_components_owner_name_uq"
      ON "analytics2_components" ("owner_email", "org_id", "normalized_name");
    CREATE INDEX IF NOT EXISTS "analytics2_components_source_idx"
      ON "analytics2_components" ("source_project_id");
  `,
});

export const REQUIRED_ANALYTICS_TABLES = [
  "analytics2_projects",
  "analytics2_project_versions",
  "analytics2_cells",
  "analytics2_collections",
  "analytics2_project_collections",
  "analytics2_project_categories",
  "analytics2_project_views",
  "analytics2_statuses",
  "analytics2_runs",
  "analytics2_cell_outputs",
  "analytics2_cell_output_generations",
  "analytics2_published_cell_outputs",
  "analytics2_dbt_query_operations",
  "analytics2_components",
  "analytics2_published_app_sessions",
  "analytics2_published_app_session_receipts",
  "analytics2_published_app_default_caches",
  "analytics2_published_app_saved_views",
  "analytics2_published_app_grants",
  "analytics2_published_app_share_receipts",
  "analytics2_published_app_schedules",
  "analytics2_published_app_schedule_recipients",
  "analytics2_published_app_schedule_ticks",
  "analytics2_published_app_schedule_deliveries",
  "analytics2_published_app_schedule_receipts",
  "analytics2_notebook_tombstones",
  "analytics2_notebook_receipts",
  "analytics2_notebook_events",
  "analytics2_visualization_results",
  "analytics2_visualization_release_sources",
  "analytics2_visualization_drills",
  "analytics2_visualization_palettes",
  "analytics2_kernel_namespaces",
  "analytics2_kernel_operations",
  "analytics2_app_layouts",
  "analytics2_notebook_reactive_inputs",
  "analytics2_notebook_creation_receipts",
  "analytics2_notebook_undo_entries",
  "analytics2_notebook_undo_revisions",
  "analytics2_thread_projects",
  "analytics2_notebook_proposals",
  "analytics2_notebook_proposal_receipts",
  "analytics2_notebook_proposal_run_intents",
  "analytics2_notebook_legacy_proposal_dispositions",
  "analytics2_thread_bootstraps",
  "analytics2_thread_turns",
  "analytics2_thread_grants",
  "analytics2_thread_receipts",
] as const;

analyticsMigrations.push({
  version: 11,
  name: "analytics2-project-shares",
  // Additive only: a companion table for project sharing. No existing table is
  // altered and nothing is deleted, so it is safe to apply with data in place.
  sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_project_shares" (
        "id" text PRIMARY KEY,
        "resource_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
        "principal_type" text NOT NULL,
        "principal_id" text NOT NULL,
        "role" text DEFAULT 'viewer' NOT NULL,
        "created_by" text DEFAULT '' NOT NULL,
        "created_at" text DEFAULT (now())::text NOT NULL,
        "notified_at" text
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_project_shares_uq"
        ON "analytics2_project_shares" ("resource_id", "principal_type", "principal_id");
      CREATE INDEX IF NOT EXISTS "analytics2_project_shares_principal_idx"
        ON "analytics2_project_shares" ("principal_type", "principal_id");
    `,
});

analyticsMigrations.push({
  version: 12,
  name: "analytics2-published-output-capture",
  sql: `
    ALTER TABLE "analytics2_project_versions"
      ADD COLUMN IF NOT EXISTS "captured_output_count" integer;
    CREATE TABLE IF NOT EXISTS "analytics2_published_cell_outputs" (
      "version_id" text NOT NULL REFERENCES "analytics2_project_versions" ("id") ON DELETE CASCADE,
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "cell_id" text NOT NULL,
      "source_connection_id" text,
      "connection_provenance_recorded" boolean NOT NULL DEFAULT false,
      "status" text NOT NULL DEFAULT 'queued',
      "output" text,
      "ran_at" text NOT NULL,
      PRIMARY KEY ("version_id", "cell_id")
    );
    CREATE INDEX IF NOT EXISTS "analytics2_published_cell_outputs_project_version_idx"
      ON "analytics2_published_cell_outputs" ("project_id", "version_id");
  `,
});

analyticsMigrations.push({
  version: 13,
  name: "analytics2-cell-output-generations",
  sql: `
    CREATE TABLE IF NOT EXISTS "analytics2_cell_output_generations" (
      "cell_id" text PRIMARY KEY,
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "generation" text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "analytics2_cell_output_generations_project_idx"
      ON "analytics2_cell_output_generations" ("project_id");
  `,
});

analyticsMigrations.push({
  version: 14,
  name: "analytics2-project-user-updated-at",
  sql: `ALTER TABLE "analytics2_projects" ADD COLUMN IF NOT EXISTS "user_updated_at" text;`,
});

analyticsMigrations.push({
  version: 15,
  name: "analytics2-project-view-kind",
  sql: `ALTER TABLE "analytics2_project_views" ADD COLUMN IF NOT EXISTS "view_kind" text;`,
});

analyticsMigrations.push({
  version: 16,
  name: "analytics2-default-status",
  sql: `ALTER TABLE "analytics2_statuses" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;`,
});

analyticsMigrations.push({
  version: 17,
  name: "analytics2-dataframe-blobs",
  sql: `
    CREATE TABLE IF NOT EXISTS "analytics2_dataframe_blobs" (
      "provider" text NOT NULL,
      "handle_id" text NOT NULL,
      "owner_email" text NOT NULL,
      "org_id" text NOT NULL,
      "project_id" text NOT NULL,
      "handle_json" text NOT NULL,
      "state" text NOT NULL DEFAULT 'live',
      "attempts" integer NOT NULL DEFAULT 0,
      "last_error" text,
      "created_at" text NOT NULL,
      PRIMARY KEY ("provider", "handle_id")
    );
    CREATE INDEX IF NOT EXISTS "analytics2_dataframe_blobs_project_idx"
      ON "analytics2_dataframe_blobs" ("owner_email", "org_id", "project_id");
  `,
});

analyticsMigrations.push({
  version: 18,
  name: "analytics2-collection-shares",
  sql: `
      CREATE TABLE IF NOT EXISTS "analytics2_collection_shares" (
        "id" text PRIMARY KEY,
        "resource_id" text NOT NULL REFERENCES "analytics2_collections" ("id") ON DELETE CASCADE,
        "principal_type" text NOT NULL,
        "principal_id" text NOT NULL,
        "role" text DEFAULT 'viewer' NOT NULL,
        "created_by" text DEFAULT '' NOT NULL,
        "created_at" text DEFAULT (now())::text NOT NULL,
        "notified_at" text
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_collection_shares_uq"
        ON "analytics2_collection_shares" ("resource_id", "principal_type", "principal_id");
      CREATE INDEX IF NOT EXISTS "analytics2_collection_shares_principal_idx"
        ON "analytics2_collection_shares" ("principal_type", "principal_id");
    `,
});

analyticsMigrations.push({
  version: 19,
  name: "analytics2-cell-output-undo",
  sql: `ALTER TABLE "analytics2_cell_outputs" ADD COLUMN IF NOT EXISTS "undo" jsonb;`,
});
analyticsMigrations.push({
  version: 20,
  name: "analytics2-notebook-commands",
  sql: `
    ALTER TABLE "analytics2_projects"
      ADD COLUMN IF NOT EXISTS "notebook_version_id" text,
      ADD COLUMN IF NOT EXISTS "notebook_revision" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_event_seq" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_order_revision" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_metadata_revision" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_input_revision" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_layout_revision" bigint NOT NULL DEFAULT 0;
    ALTER TABLE "analytics2_cells"
      ADD COLUMN IF NOT EXISTS "notebook_revision" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "notebook_label_revision" bigint NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS "analytics2_notebook_tombstones" (
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "cell_id" text NOT NULL,
      "version_id" text NOT NULL,
      "revision" bigint NOT NULL,
      "output_generation" text NOT NULL,
      PRIMARY KEY ("project_id", "cell_id")
    );
    CREATE TABLE IF NOT EXISTS "analytics2_notebook_receipts" (
      "org_id" text NOT NULL,
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "principal_id" text NOT NULL,
      "op_id" text NOT NULL,
      "fingerprint" text NOT NULL,
      "receipt" jsonb NOT NULL,
      PRIMARY KEY ("org_id", "project_id", "principal_id", "op_id")
    );
    CREATE INDEX IF NOT EXISTS "analytics2_notebook_receipts_project_idx"
      ON "analytics2_notebook_receipts" ("project_id");
    CREATE TABLE IF NOT EXISTS "analytics2_notebook_events" (
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "event_seq" bigint NOT NULL,
      "event" jsonb NOT NULL,
      PRIMARY KEY ("project_id", "event_seq")
    );
  `,
});
analyticsMigrations.push({
  version: 21,
  name: "analytics2-notebook-execution",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_notebook_runs (
      id text PRIMARY KEY,
      namespace_id text NOT NULL,
      org_id text NOT NULL,
      owner_email text NOT NULL,
      caller text NOT NULL,
      request_id text NOT NULL,
      intent text NOT NULL,
      receipt jsonb NOT NULL,
      plan jsonb NOT NULL,
      sequence bigint NOT NULL DEFAULT 0,
      UNIQUE (namespace_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_runs_actor
      ON analytics2_notebook_runs (org_id, owner_email, id);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_run_attempts (
      id text PRIMARY KEY,
      run_id text NOT NULL REFERENCES analytics2_notebook_runs (id) ON DELETE CASCADE,
      receipt jsonb NOT NULL,
      diagnostic jsonb,
      terminal boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS analytics2_notebook_run_events (
      run_id text NOT NULL REFERENCES analytics2_notebook_runs (id) ON DELETE CASCADE,
      sequence bigint NOT NULL,
      event jsonb NOT NULL,
      PRIMARY KEY (run_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS analytics2_notebook_run_work (
      submission_id text PRIMARY KEY,
      run_id text NOT NULL REFERENCES analytics2_notebook_runs (id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      ordinal integer NOT NULL,
      attempt_id text NOT NULL REFERENCES analytics2_notebook_run_attempts (id),
      generation text NOT NULL,
      lease_until bigint,
      operation_fingerprint text,
      checkpoint jsonb,
      dispatched boolean NOT NULL DEFAULT false,
      cancel_requested boolean NOT NULL DEFAULT false,
      done boolean NOT NULL DEFAULT false,
      UNIQUE (run_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_run_work_ready
      ON analytics2_notebook_run_work (run_id, ordinal) WHERE NOT done;
    CREATE TABLE IF NOT EXISTS analytics2_notebook_outputs (
      namespace_id text NOT NULL,
      cell_id text NOT NULL,
      generation text NOT NULL,
      attempt_id text,
      result_id text,
      signature text,
      PRIMARY KEY (namespace_id, cell_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_notebook_result_manifests (
      id text PRIMARY KEY,
      manifest jsonb NOT NULL,
      artifacts jsonb NOT NULL
    );
  `,
});
analyticsMigrations.push({
  version: 22,
  name: "analytics2-kernel-namespaces",
  sql: `
    CREATE TABLE IF NOT EXISTS "analytics2_kernel_namespaces" (
      "id" text PRIMARY KEY,
      "org_id" text NOT NULL,
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "scope_kind" text NOT NULL,
      "scope_id" text NOT NULL,
      "principal_id" text NOT NULL,
      "lineage_id" text NOT NULL,
      "generation" bigint NOT NULL CHECK ("generation" > 0),
      "host_id" text,
      "service_sha" text,
      "image_digest" text,
      "status" text NOT NULL CHECK ("status" IN ('reserved', 'ready', 'busy', 'stopped', 'expired')),
      "heartbeat_at" timestamptz NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_kernel_namespaces_scope_uq"
      ON "analytics2_kernel_namespaces" ("org_id", "project_id", "scope_kind", "scope_id", "principal_id");
    CREATE TABLE IF NOT EXISTS "analytics2_kernel_operations" (
      "namespace_id" text NOT NULL REFERENCES "analytics2_kernel_namespaces" ("id") ON DELETE CASCADE,
      "request_id" text NOT NULL,
      "generation" bigint NOT NULL CHECK ("generation" > 0),
      "intent" text NOT NULL,
      "receipt" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL,
      PRIMARY KEY ("namespace_id", "request_id")
    );
  `,
});
analyticsMigrations.push({
  version: 23,
  name: "analytics2-notebook-result-artifacts",
  sql: `
    ALTER TABLE analytics2_notebook_result_manifests
      ADD COLUMN IF NOT EXISTS artifact_id text,
      ADD COLUMN IF NOT EXISTS authorities jsonb,
      ADD COLUMN IF NOT EXISTS cache_key text,
      ADD COLUMN IF NOT EXISTS created_at bigint;
    CREATE INDEX IF NOT EXISTS analytics2_notebook_result_artifact_idx
      ON analytics2_notebook_result_manifests (artifact_id);
    CREATE INDEX IF NOT EXISTS analytics2_notebook_result_cache_idx
      ON analytics2_notebook_result_manifests (cache_key, created_at DESC);
    ALTER TABLE analytics2_notebook_run_work
      ADD COLUMN IF NOT EXISTS result_id text,
      ADD COLUMN IF NOT EXISTS result_build jsonb,
      ADD COLUMN IF NOT EXISTS provider_job jsonb;
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_notebook_result_build_idx
      ON analytics2_notebook_run_work (result_id) WHERE result_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS analytics2_notebook_result_segments (
      artifact_id text NOT NULL,
      start_row integer NOT NULL CHECK (start_row >= 0),
      row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 1000),
      handle jsonb NOT NULL,
      checksum text NOT NULL,
      submission_id text NOT NULL,
      verified boolean NOT NULL DEFAULT false,
      created_at bigint NOT NULL,
      PRIMARY KEY (artifact_id, start_row)
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_result_staging_idx
      ON analytics2_notebook_result_segments (created_at);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_result_views (
      view_key text PRIMARY KEY,
      page integer NOT NULL,
      revision bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS analytics2_notebook_result_view_receipts (
      view_key text NOT NULL REFERENCES analytics2_notebook_result_views (view_key) ON DELETE CASCADE,
      request_id text NOT NULL,
      intent text NOT NULL,
      result_id text NOT NULL,
      page integer NOT NULL,
      revision bigint NOT NULL,
      PRIMARY KEY (view_key, request_id)
    );
  `,
});
analyticsMigrations.push({
  version: 24,
  name: "analytics2-app-layouts",
  sql: `
    CREATE TABLE IF NOT EXISTS "analytics2_app_layouts" (
      "org_id" text NOT NULL,
      "project_id" text NOT NULL REFERENCES "analytics2_projects" ("id") ON DELETE CASCADE,
      "working_version_id" text NOT NULL REFERENCES "analytics2_project_versions" ("id") ON DELETE CASCADE,
      "layout_revision" bigint NOT NULL CHECK ("layout_revision" >= 0),
      "document" jsonb NOT NULL,
      PRIMARY KEY ("org_id", "project_id", "working_version_id")
    );
    CREATE INDEX IF NOT EXISTS "analytics2_app_layouts_version_idx"
      ON "analytics2_app_layouts" ("working_version_id");
  `,
});
analyticsMigrations.push({
  version: 25,
  name: "analytics2-notebook-run-controls",
  sql: `
    ALTER TABLE analytics2_projects
      ADD COLUMN IF NOT EXISTS notebook_default_run_mode text NOT NULL DEFAULT 'auto'
        CHECK (notebook_default_run_mode IN ('auto', 'upstream', 'downstream', 'cell-only')),
      ADD COLUMN IF NOT EXISTS notebook_auto_rerun boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS notebook_last_sql_source jsonb,
      ADD COLUMN IF NOT EXISTS notebook_run_settings_revision bigint NOT NULL DEFAULT 0;
    ALTER TABLE analytics2_notebook_run_attempts
      ADD COLUMN IF NOT EXISTS started_at text,
      ADD COLUMN IF NOT EXISTS finished_at text;
    CREATE INDEX IF NOT EXISTS analytics2_notebook_run_work_active_attempt
      ON analytics2_notebook_run_work (attempt_id) WHERE NOT done;
    CREATE TABLE IF NOT EXISTS analytics2_notebook_reactive_inputs (
      project_id text PRIMARY KEY REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      version_id text NOT NULL,
      input_cell_ids jsonb NOT NULL
    );
  `,
});
analyticsMigrations.push({
  version: 26,
  name: "analytics2-notebook-kernel-results",
  sql: `
    ALTER TABLE analytics2_notebook_run_attempts
      ADD COLUMN IF NOT EXISTS kernel_presentation jsonb;
    ALTER TABLE analytics2_notebook_outputs
      ADD COLUMN IF NOT EXISTS dependency_result_id text,
      ADD COLUMN IF NOT EXISTS dependency_signature text;
    ALTER TABLE analytics2_kernel_namespaces
      ADD COLUMN IF NOT EXISTS variable_state jsonb;
    ALTER TABLE analytics2_notebook_result_manifests
      ADD COLUMN IF NOT EXISTS bindings jsonb;
  `,
});
analyticsMigrations.push({
  version: 27,
  name: "analytics2-notebook-creation-history-and-undo",
  sql: `
    ALTER TABLE analytics2_projects ADD COLUMN IF NOT EXISTS untitled_ordinal integer;
    CREATE INDEX IF NOT EXISTS analytics2_projects_active_title_idx
      ON analytics2_projects (org_id, owner_email, title)
      WHERE trashed_at IS NULL AND archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_projects_active_untitled_idx
      ON analytics2_projects (org_id, owner_email, untitled_ordinal)
      WHERE trashed_at IS NULL AND archived_at IS NULL AND untitled_ordinal IS NOT NULL;
    CREATE TABLE IF NOT EXISTS analytics2_notebook_creation_receipts (
      workspace_id text NOT NULL,
      principal_id text NOT NULL,
      request_id text NOT NULL,
      project_id text NOT NULL,
      working_version_id text NOT NULL,
      intent_fingerprint text NOT NULL,
      receipt_json jsonb,
      committed_at text NOT NULL,
      PRIMARY KEY (workspace_id, principal_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_creation_receipts_project_idx
      ON analytics2_notebook_creation_receipts (project_id);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_undo_entries (
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects (id) ON DELETE CASCADE,
      principal_id text NOT NULL,
      version_id text NOT NULL,
      origin_id text NOT NULL,
      original_op_id text NOT NULL,
      event_seq bigint NOT NULL,
      direction text NOT NULL,
      plan jsonb NOT NULL,
      PRIMARY KEY (workspace_id, project_id, principal_id, version_id, origin_id, original_op_id)
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_undo_stack_idx
      ON analytics2_notebook_undo_entries (
        workspace_id, project_id, principal_id, version_id, origin_id, direction, event_seq DESC
      );
    CREATE TABLE IF NOT EXISTS analytics2_notebook_undo_revisions (
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects (id) ON DELETE CASCADE,
      principal_id text NOT NULL,
      version_id text NOT NULL,
      origin_id text NOT NULL,
      resource_key text NOT NULL,
      revision bigint NOT NULL,
      equivalent_revision bigint NOT NULL,
      PRIMARY KEY (workspace_id, project_id, principal_id, version_id, origin_id, resource_key, revision)
    );
    ALTER TABLE analytics2_project_versions
      ADD COLUMN IF NOT EXISTS archived_at text;
  `,
});
analyticsMigrations.push({
  version: 28,
  name: "analytics2-publish-previews-and-releases",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_publish_previews (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      actor_id text NOT NULL,
      create_request_id text NOT NULL,
      intent text NOT NULL,
      snapshot jsonb NOT NULL,
      project jsonb NOT NULL,
      compared_release_id text,
      run_id text,
      create_receipt jsonb,
      cancelled_at text,
      published_release_id text,
      created_at text NOT NULL,
      expires_at text NOT NULL,
      UNIQUE (workspace_id, project_id, actor_id, create_request_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_publish_preview_cancels (
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      actor_id text NOT NULL,
      create_request_id text NOT NULL,
      request_id text NOT NULL,
      receipt jsonb NOT NULL,
      PRIMARY KEY (workspace_id, project_id, actor_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS analytics2_publish_preview_cancel_intent_idx
      ON analytics2_publish_preview_cancels (workspace_id, project_id, actor_id, create_request_id);
    CREATE TABLE IF NOT EXISTS analytics2_project_releases (
      id text PRIMARY KEY REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      head jsonb NOT NULL,
      project jsonb NOT NULL,
      snapshot jsonb NOT NULL,
      manifest_id text NOT NULL UNIQUE,
      compared_release_id text,
      description text,
      published_at text NOT NULL,
      publisher_id text NOT NULL,
      request_id text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('ready', 'accept-errors', 'force')),
      intent text NOT NULL,
      receipt jsonb NOT NULL,
      UNIQUE (workspace_id, project_id, publisher_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_release_manifest_outputs (
      manifest_id text NOT NULL REFERENCES analytics2_project_releases(manifest_id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      state text NOT NULL CHECK (state IN ('ready', 'failed', 'missing')),
      result_id text,
      diagnostic_id text,
      attempt_id text,
      execution_signature text,
      dependency_digest text,
      authority_digest text,
      PRIMARY KEY (manifest_id, cell_id),
      CHECK ((state = 'ready') = (result_id IS NOT NULL))
    );
  `,
});
analyticsMigrations.push({
  version: 29,
  name: "analytics2-published-app-sessions",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_published_app_sessions (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      principal_email text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      release_id text NOT NULL REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      open_id text NOT NULL,
      open_intent text NOT NULL,
      input_revision bigint NOT NULL DEFAULT 0 CHECK (input_revision >= 0),
      overrides jsonb NOT NULL,
      baseline_generation bigint NOT NULL DEFAULT 0 CHECK (baseline_generation >= 0),
      baseline jsonb NOT NULL,
      baseline_refreshed_at text,
      refreshed_at text,
      run_id text,
      pending_input_ids jsonb NOT NULL,
      UNIQUE (workspace_id, principal_email, open_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_published_app_session_receipts (
      session_id text NOT NULL REFERENCES analytics2_published_app_sessions(id) ON DELETE CASCADE,
      request_id text NOT NULL,
      intent text NOT NULL,
      receipt jsonb NOT NULL,
      PRIMARY KEY (session_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_published_app_default_caches (
      release_id text PRIMARY KEY REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
      results jsonb NOT NULL,
      refreshed_at text,
      attempted_at text,
      run_id text
    );
    CREATE TABLE IF NOT EXISTS analytics2_published_app_saved_views (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES analytics2_published_app_sessions(id) ON DELETE CASCADE,
      request_id text NOT NULL,
      intent text NOT NULL,
      overrides jsonb NOT NULL,
      receipt jsonb NOT NULL,
      UNIQUE (session_id, request_id)
    );
  `,
});
analyticsMigrations.push({
  version: 30,
  name: "analytics2-notebook-proposals",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_thread_projects (
      binding_id text PRIMARY KEY,
      org_id text NOT NULL,
      app_id text NOT NULL,
      thread_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      working_version_id text NOT NULL REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('notebook', 'ask', 'app', 'magic')),
      created_by text NOT NULL,
      created_at text NOT NULL,
      overlay_revision bigint NOT NULL DEFAULT 0,
      event_cursor bigint NOT NULL DEFAULT 0,
      ended_at text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_thread_projects_live_uq
      ON analytics2_thread_projects (org_id, app_id, thread_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_thread_projects_project_idx
      ON analytics2_thread_projects (org_id, app_id, project_id);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_proposals (
      id text PRIMARY KEY,
      binding_id text NOT NULL REFERENCES analytics2_thread_projects(binding_id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      proposal_seq bigint NOT NULL,
      event_seq bigint NOT NULL,
      base_head jsonb NOT NULL,
      first_before jsonb,
      first_resources jsonb NOT NULL,
      after_projection jsonb,
      changes jsonb NOT NULL,
      dependency_ids jsonb NOT NULL,
      kind text NOT NULL CHECK (kind IN ('insert', 'edit', 'move', 'delete')),
      status text NOT NULL CHECK (status IN ('pending', 'conflicted', 'confirmed', 'undone')),
      run_intent_id text,
      decided_by text,
      decided_at text
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_proposals_active_idx
      ON analytics2_notebook_proposals (binding_id, status, proposal_seq);
    CREATE INDEX IF NOT EXISTS analytics2_notebook_proposals_cursor_idx
      ON analytics2_notebook_proposals (binding_id, event_seq);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_proposal_receipts (
      binding_id text NOT NULL REFERENCES analytics2_thread_projects(binding_id) ON DELETE CASCADE,
      actor_id text NOT NULL,
      op_id text NOT NULL,
      fingerprint text NOT NULL,
      receipt jsonb NOT NULL,
      created_at text NOT NULL,
      tool_identity jsonb,
      overlay_revision bigint NOT NULL,
      event_cursor bigint NOT NULL,
      PRIMARY KEY (binding_id, actor_id, op_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_notebook_proposal_receipts_revision_uq
      ON analytics2_notebook_proposal_receipts(binding_id, overlay_revision);
    CREATE INDEX IF NOT EXISTS analytics2_notebook_proposal_receipts_cursor_idx
      ON analytics2_notebook_proposal_receipts(binding_id, event_cursor);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_legacy_proposal_dispositions (
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      working_version_id text NOT NULL REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      legacy_id text NOT NULL,
      actor_id text NOT NULL,
      op_id text NOT NULL,
      fingerprint text NOT NULL,
      receipt jsonb NOT NULL,
      PRIMARY KEY (project_id, working_version_id, cell_id, legacy_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_notebook_legacy_proposal_op_uq
      ON analytics2_notebook_legacy_proposal_dispositions(project_id, actor_id, op_id);
    CREATE TABLE IF NOT EXISTS analytics2_notebook_proposal_run_intents (
      id text PRIMARY KEY,
      app_id text NOT NULL,
      binding_id text NOT NULL,
      thread_id text NOT NULL,
      project_id text NOT NULL,
      version_id text NOT NULL,
      org_id text NOT NULL,
      owner_email text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('thread', 'draft')),
      overlay_revision text NOT NULL,
      cell_ids jsonb NOT NULL,
      allow_candidate_reuse boolean NOT NULL,
      snapshot jsonb,
      run_id text,
      outcome text
    );
    CREATE INDEX IF NOT EXISTS analytics2_notebook_proposal_runs_due_idx
      ON analytics2_notebook_proposal_run_intents (id) WHERE outcome IS NULL;
  `,
});
analyticsMigrations.push({
  version: 31,
  name: "analytics2-full-result-visualizations",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_visualization_results (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      version_id text NOT NULL REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      source_result_id text NOT NULL,
      config_digest text NOT NULL,
      artifact jsonb NOT NULL,
      expires_at bigint NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics2_visualization_release_sources (
      version_id text NOT NULL REFERENCES analytics2_project_versions(id) ON DELETE CASCADE,
      cell_id text NOT NULL,
      result_id text NOT NULL REFERENCES analytics2_notebook_result_manifests(id),
      PRIMARY KEY (version_id, cell_id)
    );
    CREATE INDEX IF NOT EXISTS analytics2_visualization_results_expiry
      ON analytics2_visualization_results (expires_at);
    CREATE INDEX IF NOT EXISTS analytics2_visualization_release_sources_result
      ON analytics2_visualization_release_sources (result_id);
    CREATE TABLE IF NOT EXISTS analytics2_visualization_drills (
      actor_key text NOT NULL,
      request_id text NOT NULL,
      result_id text NOT NULL REFERENCES analytics2_visualization_results(id) ON DELETE CASCADE,
      intent text NOT NULL,
      expires_at bigint NOT NULL,
      PRIMARY KEY (actor_key, request_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_visualization_palettes (
      binding_key text PRIMARY KEY,
      categories jsonb NOT NULL
    );
  `,
});
analyticsMigrations.push({
  version: 32,
  name: "analytics2-published-app-sharing",
  sql: `
    ALTER TABLE analytics2_projects
      ADD COLUMN IF NOT EXISTS app_sharing_revision bigint NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS analytics2_published_app_grants (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      member_id text NOT NULL,
      role text NOT NULL DEFAULT 'app_viewer' CHECK (role = 'app_viewer'),
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_app_grant_active
      ON analytics2_published_app_grants (workspace_id, project_id, member_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_app_grant_member_active
      ON analytics2_published_app_grants (workspace_id, member_id, project_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS analytics2_published_app_share_receipts (
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      actor_id text NOT NULL,
      op_id uuid NOT NULL,
      fingerprint text NOT NULL,
      receipt jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, project_id, actor_id, op_id)
    );
  `,
});
analyticsMigrations.push({
  version: 33,
  name: "analytics2-published-app-schedules",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_published_app_schedules (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      creator_id text NOT NULL,
      run_principal_id text NOT NULL,
      revision bigint NOT NULL,
      enabled boolean NOT NULL,
      cadence jsonb NOT NULL,
      timezone text NOT NULL,
      normalized_cron text NOT NULL,
      update_published_results boolean NOT NULL,
      use_cached_sql_results boolean NOT NULL,
      target text NOT NULL,
      next_fire_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE INDEX IF NOT EXISTS analytics2_schedule_due_idx
      ON analytics2_published_app_schedules (next_fire_at, id)
      WHERE enabled AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_schedule_project_idx
      ON analytics2_published_app_schedules (workspace_id, project_id, id)
      WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS analytics2_published_app_schedule_recipients (
      id text PRIMARY KEY,
      schedule_id text NOT NULL REFERENCES analytics2_published_app_schedules(id) ON DELETE CASCADE,
      member_id text NOT NULL,
      trigger text NOT NULL,
      enabled boolean NOT NULL,
      created_at text NOT NULL,
      revoked_at text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_schedule_recipient_live_idx
      ON analytics2_published_app_schedule_recipients (schedule_id, member_id)
      WHERE enabled AND revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_schedule_recipient_member_idx
      ON analytics2_published_app_schedule_recipients (member_id, schedule_id)
      WHERE enabled AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS analytics2_published_app_schedule_ticks (
      id text PRIMARY KEY,
      schedule_id text NOT NULL REFERENCES analytics2_published_app_schedules(id) ON DELETE CASCADE,
      workspace_id text NOT NULL,
      project_id text NOT NULL,
      principal_id text NOT NULL,
      due_at text NOT NULL,
      schedule_revision bigint NOT NULL,
      release_id text,
      snapshot jsonb,
      input_digest text,
      flags jsonb NOT NULL,
      recipient_snapshot jsonb NOT NULL,
      core_history_id text NOT NULL,
      run_id text,
      status text NOT NULL,
      cache_reservation bigint,
      cache_outcome text NOT NULL,
      diagnostic jsonb,
      created_at text NOT NULL,
      terminal_at text,
      UNIQUE (schedule_id, due_at)
    );
    CREATE INDEX IF NOT EXISTS analytics2_schedule_tick_outbox_idx
      ON analytics2_published_app_schedule_ticks (due_at, id)
      WHERE terminal_at IS NULL;
    CREATE INDEX IF NOT EXISTS analytics2_schedule_tick_project_idx
      ON analytics2_published_app_schedule_ticks (workspace_id, project_id, due_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS analytics2_published_app_schedule_deliveries (
      id text PRIMARY KEY,
      tick_id text NOT NULL REFERENCES analytics2_published_app_schedule_ticks(id) ON DELETE CASCADE,
      recipient_id text NOT NULL,
      event_type text NOT NULL,
      dedup_key text NOT NULL UNIQUE,
      status text NOT NULL,
      delivery_attempt_id text,
      send_attempts integer NOT NULL,
      first_attempt_at text,
      sent_at text,
      last_error_code text,
      next_retry_at text,
      updated_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics2_schedule_delivery_tick_idx
      ON analytics2_published_app_schedule_deliveries (tick_id);
    CREATE INDEX IF NOT EXISTS analytics2_schedule_delivery_due_idx
      ON analytics2_published_app_schedule_deliveries (next_retry_at, id)
      WHERE status IN ('pending', 'sending');
    CREATE TABLE IF NOT EXISTS analytics2_published_app_schedule_receipts (
      workspace_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      actor_id text NOT NULL,
      op_id text NOT NULL,
      fingerprint text NOT NULL,
      response jsonb NOT NULL,
      committed_at text NOT NULL,
      PRIMARY KEY (workspace_id, project_id, actor_id, op_id)
    );
    ALTER TABLE analytics2_published_app_default_caches
      ADD COLUMN IF NOT EXISTS schedule_due_at text;
  `,
});
analyticsMigrations.push({
  version: 34,
  name: "analytics2-ask-thread-lifecycle",
  sql: `
    ALTER TABLE analytics2_projects ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT true;
    CREATE TABLE IF NOT EXISTS analytics2_thread_bootstraps (
      org_id text NOT NULL, app_id text NOT NULL, owner_email text NOT NULL,
      intent_id uuid NOT NULL, fingerprint text NOT NULL, reserved_project_id text NOT NULL,
      reserved_thread_id text NOT NULL UNIQUE, binding_id text NOT NULL UNIQUE,
      mode text NOT NULL, phase text NOT NULL, initial_message_id uuid,
      bounded_initial_prompt jsonb, upload_manifest jsonb NOT NULL,
      share_revision bigint NOT NULL DEFAULT 0, updated_at text NOT NULL,
      PRIMARY KEY (org_id, app_id, owner_email, intent_id)
    );
    CREATE TABLE IF NOT EXISTS analytics2_thread_turns (
      binding_id text NOT NULL REFERENCES analytics2_thread_projects(binding_id) ON DELETE CASCADE,
      message_id uuid NOT NULL, seq bigint NOT NULL, fingerprint text NOT NULL,
      pending_prompt jsonb, source_ids jsonb NOT NULL, private_context boolean NOT NULL DEFAULT false, admission_receipt jsonb, terminal_projection jsonb,
      stopped_at text, created_at text NOT NULL,
      PRIMARY KEY (binding_id, message_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_thread_turn_seq ON analytics2_thread_turns (binding_id, seq);
    CREATE TABLE IF NOT EXISTS analytics2_thread_grants (
      id text PRIMARY KEY, binding_id text NOT NULL REFERENCES analytics2_thread_projects(binding_id) ON DELETE CASCADE,
      member_id text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS analytics2_thread_grant_member ON analytics2_thread_grants(binding_id, member_id);
    CREATE INDEX IF NOT EXISTS analytics2_thread_grant_page ON analytics2_thread_grants(binding_id, id);
    CREATE TABLE IF NOT EXISTS analytics2_thread_receipts (
      binding_id text NOT NULL REFERENCES analytics2_thread_projects(binding_id) ON DELETE CASCADE,
      op_id uuid NOT NULL, fingerprint text NOT NULL, receipt jsonb NOT NULL,
      PRIMARY KEY (binding_id, op_id)
    );
  `,
});
analyticsMigrations.push({
  version: 35,
  name: "analytics2-collection-emoji",
  sql: `ALTER TABLE "analytics2_collections" ADD COLUMN IF NOT EXISTS "emoji" text;`,
});
analyticsMigrations.push({
  version: 36,
  name: "analytics2-app-signed-embedding",
  sql: `
    ALTER TABLE analytics2_projects
      ADD COLUMN IF NOT EXISTS allow_embedding boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS analytics2_signed_embed_tokens (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      created_by_email text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      user_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      expires_at text NOT NULL,
      revoked_at text,
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics2_signed_embed_tokens_project_idx
      ON analytics2_signed_embed_tokens (org_id, project_id, created_at DESC);
  `,
});

analyticsMigrations.push({
  version: 37,
  name: "analytics2-project-connection-links",
  sql: `
    CREATE TABLE IF NOT EXISTS analytics2_project_connection_links (
      project_id text NOT NULL REFERENCES analytics2_projects(id) ON DELETE CASCADE,
      workspace_id text NOT NULL,
      connection_id text NOT NULL,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, connection_id)
    );
  `,
});

export const runAnalyticsMigrations = runMigrations([...analyticsMigrations], {
  table: "analytics2_migrations",
});
