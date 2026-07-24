import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  migrateAnalyticsArtifacts,
  type AnalyticsArtifactMigrationContext,
} from "../server/lib/migrate-analytics-artifacts.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections";

const confirmation = "MIGRATE_ANALYTICS_ARTIFACTS" as const;

export default defineAction({
  description:
    "Inventory or consolidate all organization-scoped Analytics dashboards, saved analyses, and extensions into the canonical Dashboards list. The default is a read-only dry run. A write requires an organization owner/admin and confirm=MIGRATE_ANALYTICS_ARTIFACTS; exact duplicates are archived/hidden, source rows remain recoverable, shares are copied, and legacy settings keys are removed only after SQL materialization.",
  schema: z.object({
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe("Inspect the migration without writing when true (default)."),
    confirm: z
      .literal(confirmation)
      .optional()
      .describe(
        "Required for writes: MIGRATE_ANALYTICS_ARTIFACTS. Do not send this for a dry run.",
      ),
  }),
  run: async ({ dryRun, confirm }, ctx) => {
    const userEmail = getRequestUserEmail() || ctx?.userEmail;
    const orgId = getRequestOrgId() || ctx?.orgId || null;
    const admin = await requireAnalyticsAdminContext({ userEmail, orgId });
    if (!dryRun && confirm !== confirmation) {
      throw new Error(
        `Refusing the Analytics organization migration without confirm=${confirmation}. Run a dry run first, then repeat with the exact confirmation token.`,
      );
    }
    const migrationContext: AnalyticsArtifactMigrationContext = {
      userEmail: admin.userEmail,
      orgId: admin.orgId,
    };
    return migrateAnalyticsArtifacts(migrationContext, { dryRun });
  },
});
