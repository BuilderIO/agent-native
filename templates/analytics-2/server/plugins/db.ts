import { registerIdentityColumns } from "@agent-native/core/org";

import { ensureAnalyticsDatabase } from "../model/database.js";

/**
 * The workspace stores every project, collection and status under the account
 * that owns it, so an email change has to follow those rows and offboarding has
 * to take them with the member.
 */
registerIdentityColumns([
  {
    table: "analytics2_projects",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason: "Projects belong to the member who created them.",
  },
  {
    table: "analytics2_collections",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason: "Collections belong to the member who created them.",
  },
  {
    table: "analytics2_statuses",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason: "Project statuses are configured per member workspace.",
  },
  {
    table: "analytics2_notebook_runs",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason: "Notebook runs belong to their admitting member.",
  },
  {
    table: "analytics2_project_versions",
    column: "created_by",
    emailChange: "rekey",
    offboard: "retain",
    reason:
      "A version records who saved it; the history stays with the project.",
  },
]);

/**
 * Specs that build their own PGlite await this to create the schema before they
 * exercise an action. It is the same entry the plugin runs on boot, named so a
 * test can await it directly; the legacy env argument is accepted and unused
 * because the database module resolves its own request-scoped connection.
 */
export async function runAnalytics2Migrations(
  _env?: Record<string, unknown>,
): Promise<void> {
  await ensureAnalyticsDatabase();
}

export default function registerAnalyticsDatabase(): void {
  ensureAnalyticsDatabase().catch((error: unknown) => {
    console.error("[analytics-2] workspace database setup failed", error);
  });
}
