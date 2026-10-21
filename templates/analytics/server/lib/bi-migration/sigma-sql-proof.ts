import { fail, isActionContractError } from "@agent-native/core/action";

import {
  BigQueryDryRunPreparationError,
  classifyDryRunFailure,
  dryRunQuerySchema,
} from "../bigquery.js";
import {
  DEFAULT_MAX_BYTES_TO_EXECUTE,
  runPool,
} from "../dashboard-panel-verification.js";
import { assertReadOnlySql } from "../read-only-sql.js";
import type {
  SigmaWorkbookInspection,
  SigmaWorkbookSqlQuery,
} from "./sigma-adapter.js";

export type SigmaSqlProofFailure =
  | "query_unavailable"
  | "sql_too_large"
  | "unsafe_sql"
  | "bigquery_dry_run_failed"
  | "bigquery_dry_run_unavailable"
  | "too_expensive"
  | "cost_unknown";

export type SigmaSqlProof =
  | { ok: true; sql: string; estimatedBytes: number }
  /** `skipped`: the deadline passed before this panel was dry-run. */
  | { ok: false; reason: SigmaSqlProofFailure; skipped?: true };

const DRY_RUN_CONCURRENCY = 8;

/**
 * Check each Sigma element's compiled SQL the way a panel would run it: one
 * read-only statement that Analytics' BigQuery credential can dry-run.
 * Throws when BigQuery cannot be reached at all, so a missing credential
 * never reads as every panel's SQL being wrong.
 */
export async function proveSigmaPanelSql(
  inspection: SigmaWorkbookInspection,
  elementIds: readonly string[],
  options: { deadline?: number } = {},
): Promise<Map<string, SigmaSqlProof>> {
  const queriesByElementId = new Map<string, SigmaWorkbookSqlQuery[]>();
  for (const query of inspection.sqlQueries) {
    if (!query.elementId) continue;
    const queries = queriesByElementId.get(query.elementId) ?? [];
    queries.push(query);
    queriesByElementId.set(query.elementId, queries);
  }
  const proofs = await runPool(
    [...elementIds],
    DRY_RUN_CONCURRENCY,
    async (elementId) =>
      [
        elementId,
        options.deadline !== undefined && Date.now() >= options.deadline
          ? ({
              ok: false,
              reason: "bigquery_dry_run_unavailable",
              skipped: true,
            } as const)
          : await proveOne(queriesByElementId.get(elementId)),
      ] as const,
  );
  return new Map(proofs);
}

async function proveOne(
  queries: SigmaWorkbookSqlQuery[] | undefined,
): Promise<SigmaSqlProof> {
  // A panel runs one query; an element Sigma returned none for, or split
  // into several, has no single statement to import.
  if (queries?.length !== 1) return { ok: false, reason: "query_unavailable" };
  const [query] = queries;
  if (!query.sql) {
    const tooLarge =
      query.sqlOmittedReason === "query-too-large" ||
      query.sqlOmittedReason === "total-sql-limit";
    return {
      ok: false,
      reason: tooLarge ? "sql_too_large" : "query_unavailable",
    };
  }
  try {
    assertReadOnlySql(query.sql, "bigquery");
  } catch (error) {
    if (!isActionContractError(error)) throw error;
    return { ok: false, reason: "unsafe_sql" };
  }

  let dryRun: Awaited<ReturnType<typeof dryRunQuerySchema>>;
  try {
    dryRun = await dryRunQuerySchema(query.sql, {
      wrapPreparationErrors: true,
    });
  } catch (error) {
    if (!(error instanceof BigQueryDryRunPreparationError)) throw error;
    if (error.notConfigured) {
      fail("Connect an Analytics BigQuery source before importing Sigma SQL.", {
        errorCode: "analytics_bigquery_required",
        statusCode: 409,
      });
    }
    fail("BigQuery could not check this workbook's SQL. Try again.", {
      errorCode: "bigquery_dry_run_unavailable",
      statusCode: 503,
    });
  }
  if (dryRun.error === null) {
    // A panel runs on every view, so one without a byte estimate under the
    // cap is not imported.
    if (dryRun.totalBytesProcessed === undefined) {
      return { ok: false, reason: "cost_unknown" };
    }
    if (dryRun.totalBytesProcessed > DEFAULT_MAX_BYTES_TO_EXECUTE) {
      return { ok: false, reason: "too_expensive" };
    }
    return {
      ok: true,
      sql: query.sql,
      estimatedBytes: dryRun.totalBytesProcessed,
    };
  }
  const failure = classifyDryRunFailure(dryRun);
  if (failure === "credential_denied") {
    fail(
      "Analytics' BigQuery connection can't run queries. Check its permissions in Data sources.",
      { errorCode: "analytics_bigquery_permission_denied", statusCode: 409 },
    );
  }
  return {
    ok: false,
    reason:
      failure === "rejected_sql"
        ? "bigquery_dry_run_failed"
        : "bigquery_dry_run_unavailable",
  };
}
