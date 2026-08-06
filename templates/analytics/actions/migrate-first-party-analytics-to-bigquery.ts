import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  assertFirstPartyAnalyticsBigQueryReady,
  backfillFirstPartyAnalyticsBatch,
  getFirstPartyAnalyticsBackend,
  saveFirstPartyAnalyticsBackend,
} from "../server/lib/first-party-analytics-backend.js";

async function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  if (!orgId) {
    throw new Error(
      "An active organization is required for the first-party Analytics migration.",
    );
  }
  const admin = await requireAnalyticsAdminContext({ userEmail, orgId });
  return { userEmail: admin.userEmail, orgId: admin.orgId };
}

const migrationSchema = z.object({
  mode: z.enum(["status", "prepare", "backfill", "cutover"]),
  table: z
    .string()
    .trim()
    .optional()
    .describe(
      "Optional BigQuery table reference as dataset.table or project.dataset.table. The default is <BIGQUERY_PROJECT_ID>.analytics.first_party_analytics_events_raw.",
    ),
  cursor: z.string().trim().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  confirm: z.boolean().optional(),
});

export default defineAction({
  description:
    "UI-only production migration for the current Analytics organization. Run prepare to validate the configured BigQuery table and enter dual-write mode, call backfill repeatedly with the returned cursor until complete, then call cutover with confirm=true. New /track events stay in Postgres during dual-write, so a BigQuery outage does not silently lose live data. Cutover is the only step that stops analytics event and rollup writes to Postgres; public-key metadata, derived exception issues, and session-replay data remain in the SQL store.",
  schema: migrationSchema,
  agentTool: false,
  needsApproval: ({ mode }) => mode === "cutover",
  run: async ({ mode, table, cursor, limit, confirm }) => {
    const scope = await resolveScope();
    const current = await getFirstPartyAnalyticsBackend(scope);
    const configuredTable = table ?? current.table;

    if (mode === "status") {
      const ready =
        current.sink === "postgres"
          ? null
          : await assertFirstPartyAnalyticsBigQueryReady(current.table);
      return {
        ...current,
        ready: Boolean(ready),
        rowCount: ready?.rowCount ?? null,
        table: ready?.table.fullyQualified ?? current.table,
      };
    }

    if (mode === "prepare") {
      const ready =
        await assertFirstPartyAnalyticsBigQueryReady(configuredTable);
      await saveFirstPartyAnalyticsBackend(scope, {
        sink: "dual",
        table: ready.table.fullyQualified,
        backfillCursor: null,
        backfillCompleted: false,
      });
      return {
        sink: "dual" as const,
        table: ready.table.fullyQualified,
        existingBigQueryRows: ready.rowCount,
        next: "backfill",
      };
    }

    if (mode === "backfill") {
      if (current.sink !== "dual") {
        throw new Error(
          "Prepare the organization for dual-write before starting the BigQuery backfill.",
        );
      }
      const result = await backfillFirstPartyAnalyticsBatch(
        scope,
        cursor ?? current.backfillCursor ?? null,
        limit ?? 500,
        current.table,
      );
      await saveFirstPartyAnalyticsBackend(scope, {
        sink: "dual",
        table: current.table,
        backfillCursor: result.nextCursor,
        backfillCompleted: result.complete,
      });
      return {
        ...result,
        sink: "dual" as const,
        table: current.table,
        next: result.complete ? "cutover" : "backfill",
      };
    }

    if (!confirm) {
      throw new Error(
        "Cutover requires confirm=true because it stops first-party event and rollup writes to Postgres for this organization.",
      );
    }
    if (current.sink !== "dual" || current.backfillCompleted !== true) {
      throw new Error(
        "Complete the dual-write backfill before cutting over to BigQuery.",
      );
    }
    const ready = await assertFirstPartyAnalyticsBigQueryReady(current.table);
    await saveFirstPartyAnalyticsBackend(scope, {
      sink: "bigquery",
      table: ready.table.fullyQualified,
      backfillCursor: current.backfillCursor,
      backfillCompleted: true,
    });
    return {
      sink: "bigquery" as const,
      table: ready.table.fullyQualified,
      existingBigQueryRows: ready.rowCount,
      postgresEventWrites: "stopped",
      next: "verify dashboards",
    };
  },
});
