import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { dryRunQuerySchema } from "../server/lib/bigquery.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  firstPartyEventsModelProjection,
  getFirstPartyAnalyticsBackend,
  saveFirstPartyEventsModelTable,
} from "../server/lib/first-party-analytics-backend.js";
import { resolveSourceGeneration } from "../server/lib/source-generation.js";

const TABLE_ID = /^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z_]\w*\.[A-Za-z_]\w*$/;

type ModelCheck =
  | {
      status: "ok";
      table: string;
      modifiedAt: string;
      ageMs: number;
      stale: boolean;
      recentDayBytes: number | null;
      fullScanBytes: number | null;
    }
  | { status: "unavailable"; table: string; reason: string; message?: string };

function utcDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// Dry runs only: BigQuery plans the query and reports the bytes it would
// scan, but runs and bills nothing. Both read every projected column: BigQuery
// bills only the columns a query reads, so COUNT(*) would report almost nothing
// while a chart can read any of them.
async function checkModel(
  table: string,
  signal?: AbortSignal,
): Promise<ModelCheck> {
  const generation = await resolveSourceGeneration([table], {
    force: true,
    signal,
  });
  if (generation.status === "unavailable") {
    return { status: "unavailable", table, reason: generation.reason };
  }
  const projection = `(${firstPartyEventsModelProjection(table)}) AS analytics_events`;
  const recent = await dryRunQuerySchema(
    `SELECT * FROM ${projection} WHERE event_date >= DATE '${utcDateDaysAgo(1)}'`,
    { signal },
  );
  if (recent.error) {
    return {
      status: "unavailable",
      table,
      reason: "query_denied",
      message: recent.error,
    };
  }
  // Eligible chart SQL need not bound event_date, so a model that refuses an
  // unbounded read (a required partition filter, say) would fail those charts.
  const full = await dryRunQuerySchema(`SELECT * FROM ${projection}`, {
    signal,
  });
  if (full.error) {
    return {
      status: "unavailable",
      table,
      reason: "full_read_denied",
      message: full.error,
    };
  }
  return {
    status: "ok",
    table,
    modifiedAt: generation.oldestModifiedAt,
    ageMs: generation.ageMs,
    stale: generation.stale,
    recentDayBytes: recent.totalBytesProcessed ?? null,
    fullScanBytes: full.totalBytesProcessed ?? null,
  };
}

export default defineAction({
  // set and clear replace the org-wide model every first-party chart reads.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "Check or set the warehouse events model that first-party Analytics charts read instead of the raw event table. `check` (any org member) reads the model's table metadata and dry-runs the chart projection against it as the app, reporting whether the app can query it and the most bytes a chart reading one day or all of it could scan (every column); it runs and bills no query. `set` (org admin, needs approval) runs the same check and saves the model only if it passes. `clear` (org admin, needs approval) sends charts back to the raw table. Charts that read columns or events the model lacks, alerts, and onboarding journeys keep reading the raw table either way.",
  schema: z.object({
    mode: z.enum(["check", "set", "clear"]),
    table: z
      .string()
      .trim()
      .optional()
      .describe(
        "Model table as project.dataset.table. Required for set; check defaults to the configured model.",
      ),
  }),
  needsApproval: ({ mode }) => mode !== "check",
  run: async ({ mode, table }, context) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to configure the Analytics model", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId();
    if (!orgId) {
      fail("An active organization is required to configure the model", {
        errorCode: "organization_required",
        statusCode: 403,
      });
    }
    const signal = context?.signal;
    const scope =
      mode === "check"
        ? { userEmail, orgId }
        : await requireAnalyticsAdminContext({ userEmail, orgId });

    if (mode === "clear") {
      await saveFirstPartyEventsModelTable(scope, null);
      return { status: "cleared" as const };
    }

    const target =
      table ||
      (mode === "check"
        ? (await getFirstPartyAnalyticsBackend(scope, signal)).modelTable
        : null);
    if (!target) {
      fail("Name the model table as project.dataset.table", {
        errorCode: "model_table_required",
        statusCode: 400,
      });
    }
    if (!TABLE_ID.test(target)) {
      fail("The model table must be project.dataset.table", {
        errorCode: "invalid_model_table",
        statusCode: 400,
      });
    }

    const check = await checkModel(target, signal);
    if (mode === "check") return check;
    if (check.status !== "ok") {
      fail(
        `The app cannot read ${target} (${check.reason}); the model was not saved`,
        { errorCode: "model_unreadable", statusCode: 424 },
      );
    }
    await saveFirstPartyEventsModelTable(scope, target);
    return { ...check, status: "saved" as const };
  },
});
