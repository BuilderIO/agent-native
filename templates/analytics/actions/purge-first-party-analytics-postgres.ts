import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  assertFirstPartyAnalyticsBigQueryReady,
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsBigQueryMetrics,
} from "../server/lib/first-party-analytics-backend.js";
import {
  countFirstPartyAnalyticsPostgresRows,
  purgeFirstPartyAnalyticsPostgresRows,
} from "../server/lib/first-party-analytics-purge.js";

const confirmation = "PURGE_FIRST_PARTY_POSTGRES_EVENTS" as const;
const DAY_MS = 24 * 60 * 60 * 1000;

async function resolveScope() {
  const userEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  const admin = await requireAnalyticsAdminContext({ userEmail, orgId });
  return { userEmail: admin.userEmail, orgId: admin.orgId };
}

export default defineAction({
  description:
    "Dry-run or explicitly purge a bounded 30-60 day window of the current organization's first-party event rows and derived rollups from Postgres after BigQuery cutover. The default is read-only. The write path requires the BigQuery sink, a completed backfill, exact confirmation, and normal action approval; exception issues, session replay, public-key metadata, migration state, and volume counters are never deleted.",
  agentTool: false,
  schema: z.object({
    lookbackDays: z
      .number()
      .int()
      .min(30)
      .max(60)
      .optional()
      .default(60)
      .describe("Bound the purge to the most recent 30-60 days (default 60)."),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe("Inspect counts without deleting when true (default)."),
    includeLegacyOwnerRows: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include legacy rows with this owner's email and no org id. Keep false unless the dry-run proves those rows belong to this migration.",
      ),
    allowUncopiedEvents: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Allow deletion when the scoped BigQuery event count is lower than Postgres. Keep false to prevent data loss from skipped historical event types.",
      ),
    confirm: z
      .literal(confirmation)
      .optional()
      .describe(
        "Required for deletion: PURGE_FIRST_PARTY_POSTGRES_EVENTS. Do not send it for a dry run.",
      ),
  }),
  needsApproval: ({ dryRun }) => !dryRun,
  run: async ({
    lookbackDays,
    dryRun,
    includeLegacyOwnerRows,
    allowUncopiedEvents,
    confirm,
  }) => {
    const scope = await resolveScope();
    if (!dryRun && confirm !== confirmation) {
      throw new Error(
        `Refusing to delete first-party Postgres events without confirm=${confirmation}. Run a dry run first, then repeat with the exact confirmation token.`,
      );
    }

    const backend = await getFirstPartyAnalyticsBackend(scope);
    const startReceivedAt = new Date(
      Date.now() - lookbackDays * DAY_MS,
    ).toISOString();
    const window = {
      startReceivedAt,
      startEventDate: startReceivedAt.slice(0, 10),
    };
    let postgres: Awaited<
      ReturnType<typeof countFirstPartyAnalyticsPostgresRows>
    > | null = null;
    let postgresError: string | null = null;
    try {
      postgres = await countFirstPartyAnalyticsPostgresRows(
        scope,
        includeLegacyOwnerRows,
        window,
      );
    } catch (error) {
      if (!dryRun) throw error;
      postgresError = error instanceof Error ? error.message : String(error);
    }
    let bigQuery: {
      eventCount: number;
      dailyRollupRows: number;
      firstEventDate: string | null;
      lastEventDate: string | null;
    } | null = null;
    let bigQueryError: string | null = null;
    if (backend.table) {
      try {
        await assertFirstPartyAnalyticsBigQueryReady(backend.table, {
          includeRowCount: false,
        });
        bigQuery = await getFirstPartyAnalyticsBigQueryMetrics(
          scope,
          backend.table,
          { includeLegacyOwnerRows, startDate: window.startEventDate },
        );
      } catch (error) {
        bigQueryError = error instanceof Error ? error.message : String(error);
      }
    }

    const uncopiedEventRows =
      bigQuery && postgres
        ? Math.max(0, postgres.eventRows - bigQuery.eventCount)
        : null;
    const safeToDelete =
      backend.sink === "bigquery" &&
      backend.backfillCompleted === true &&
      postgresError === null &&
      postgres !== null &&
      bigQueryError === null &&
      bigQuery !== null &&
      uncopiedEventRows === 0;

    if (!dryRun) {
      if (backend.sink !== "bigquery") {
        throw new Error(
          "Postgres purge is blocked until this organization has completed the normal BigQuery cutover.",
        );
      }
      if (backend.backfillCompleted !== true) {
        throw new Error(
          "Postgres purge is blocked until the durable BigQuery backfill reports completed.",
        );
      }
      if (postgresError || !postgres) {
        throw new Error(
          `Postgres purge is blocked because the scoped Postgres inventory could not be verified: ${postgresError ?? "unknown Postgres state"}`,
        );
      }
      if (bigQueryError || !bigQuery) {
        throw new Error(
          `Postgres purge is blocked because BigQuery readiness could not be verified: ${bigQueryError ?? "unknown warehouse state"}`,
        );
      }
      if (uncopiedEventRows !== 0 && !allowUncopiedEvents) {
        throw new Error(
          `Postgres purge is blocked: ${uncopiedEventRows} scoped event rows are not present in BigQuery. Keep allowUncopiedEvents=false unless this loss is explicitly accepted.`,
        );
      }
      const deleted = await purgeFirstPartyAnalyticsPostgresRows(
        scope,
        includeLegacyOwnerRows,
        window,
      );
      return {
        dryRun: false,
        lookbackDays,
        window,
        deleted,
        bigQuery,
        uncopiedEventRows,
        includeLegacyOwnerRows,
        preserved: [
          "analytics_exception_events",
          "error_issues",
          "error_issue_occurrences",
          "session_recordings",
          "session_replay_chunks",
          "session_replay_ingests",
          "analytics_public_keys",
          "analytics_event_volume_usage",
        ],
      };
    }

    return {
      dryRun: true,
      lookbackDays,
      window,
      sink: backend.sink,
      backfillCompleted: backend.backfillCompleted === true,
      postgres,
      postgresError,
      bigQuery,
      bigQueryError,
      uncopiedEventRows,
      includeLegacyOwnerRows,
      safeToDelete,
      confirmationRequired: confirmation,
    };
  },
});
