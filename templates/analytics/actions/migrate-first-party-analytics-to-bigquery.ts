import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  getFirstPartyAnalyticsBigQueryBackfillJob,
  queueFirstPartyAnalyticsBigQueryBackfill,
} from "../server/jobs/analytics-bigquery-backfill.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  assertFirstPartyAnalyticsBigQueryReady,
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
  limit: z
    .number()
    .int()
    .min(1)
    .max(750)
    .optional()
    .describe(
      "Optional per-page limit used when mode is prepare; for an existing job, it can only increase the bounded batch size.",
    ),
  confirm: z.boolean().optional(),
});

export default defineAction({
  description:
    "Production migration for the current Analytics organization. Run prepare to validate the configured BigQuery table, enter dual-write mode, and enqueue a durable single-flight worker. The worker uses bounded pages, a persisted cursor, a lease, and a database-pressure gate; it pauses instead of competing with live traffic. Call status or backfill to inspect progress, then call cutover with confirm=true only after the worker reports completed. New /track events stay in Postgres during dual-write, so a BigQuery outage does not silently lose live data. Cutover is the only step that stops first-party event and rollup writes to Postgres; public-key metadata, derived exception issues, and session-replay data remain in the SQL store.",
  schema: migrationSchema,
  agentTool: false,
  needsApproval: ({ mode }) => mode === "cutover",
  run: async ({ mode, table, limit, confirm }) => {
    const scope = await resolveScope();
    const current = await getFirstPartyAnalyticsBackend(scope);
    const configuredTable = table ?? current.table;

    if (mode === "status") {
      const ready =
        current.sink === "postgres"
          ? null
          : await assertFirstPartyAnalyticsBigQueryReady(current.table);
      const job =
        current.sink === "postgres"
          ? null
          : await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
      return {
        ...current,
        backfillCursor:
          current.sink === "dual"
            ? (job?.cursor ?? null)
            : current.backfillCursor,
        backfillCompleted:
          current.sink === "dual"
            ? job?.status === "completed"
            : current.backfillCompleted,
        ready: Boolean(ready),
        rowCount: ready?.rowCount ?? null,
        table: ready?.table.fullyQualified ?? current.table,
        job,
      };
    }

    if (mode === "prepare") {
      if (current.sink === "bigquery") {
        throw new Error(
          "This organization has already cut over to BigQuery; preparing it again is not supported.",
        );
      }
      const ready =
        await assertFirstPartyAnalyticsBigQueryReady(configuredTable);
      const existingJob =
        await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
      if (existingJob && existingJob.table !== ready.table.fullyQualified) {
        throw new Error(
          `BigQuery backfill already targets ${existingJob.table}; prepare the existing migration before changing tables.`,
        );
      }
      const initialCursor =
        existingJob?.cursor ?? current.backfillCursor ?? null;
      if (
        !existingJob &&
        current.sink === "dual" &&
        !initialCursor &&
        ready.rowCount > 0
      ) {
        throw new Error(
          "Refusing to restart an existing dual-write BigQuery backfill without its legacy cursor; recover the migration cursor before preparing again.",
        );
      }
      const initialCompleted =
        existingJob?.status === "completed" ||
        current.backfillCompleted === true;
      await saveFirstPartyAnalyticsBackend(scope, {
        sink: "dual",
        table: ready.table.fullyQualified,
        backfillCursor: initialCursor,
        backfillCompleted: initialCompleted,
      });
      const job = await queueFirstPartyAnalyticsBigQueryBackfill(
        scope,
        ready.table.fullyQualified,
        limit,
        initialCursor,
      );
      return {
        sink: "dual" as const,
        table: ready.table.fullyQualified,
        existingBigQueryRows: ready.rowCount,
        job,
        next: "backfill",
      };
    }

    if (mode === "backfill") {
      if (current.sink !== "dual") {
        throw new Error(
          "Prepare the organization for dual-write before starting the BigQuery backfill.",
        );
      }
      const job = await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
      if (!job) {
        throw new Error(
          "Prepare the organization before enqueueing the BigQuery backfill.",
        );
      }
      return {
        sink: "dual" as const,
        table: current.table,
        job,
        next: job.status === "completed" ? "cutover" : "backfill",
        queued: job.status !== "completed",
      };
    }

    if (!confirm) {
      throw new Error(
        "Cutover requires confirm=true because it stops first-party event and rollup writes to Postgres for this organization.",
      );
    }
    const job = await getFirstPartyAnalyticsBigQueryBackfillJob(scope);
    if (current.sink !== "dual" || job?.status !== "completed") {
      throw new Error(
        "Wait for the durable dual-write backfill job to report completed before cutting over to BigQuery.",
      );
    }
    const ready = await assertFirstPartyAnalyticsBigQueryReady(current.table);
    await saveFirstPartyAnalyticsBackend(scope, {
      sink: "bigquery",
      table: ready.table.fullyQualified,
      backfillCursor: job.cursor,
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
