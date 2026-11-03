import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { getDbExec } from "@agent-native/core/db";
import { retainRequestDbPoolScope } from "@agent-native/core/db/request-pool-context";
import {
  getRequestRunContext,
  platformWaitUntil,
} from "@agent-native/core/server";

import type { BigQueryUsageAccounting } from "../../shared/sql-query-contract";
import type { CredentialContext } from "./credentials-context";

/** Server-owned provenance only. Never accept these fields directly from tool input. */
export type BigQueryUsageAttribution = {
  workload:
    | "dashboard-panel"
    | "dashboard-report"
    | "panel-verification"
    | "alert";
  dashboardId?: string;
  panelId?: string;
};
const attribution = new AsyncLocalStorage<BigQueryUsageAttribution>();
export function withBigQueryUsageAttribution<T>(
  context: BigQueryUsageAttribution,
  run: () => T,
): T {
  return attribution.run(context, run);
}

export type BigQueryJobUsage = {
  projectId: string;
  jobId: string;
  location?: string | undefined;
  ownerEmail: string;
  orgId: string | null;
  credentialScope: string;
  workload: string;
  dashboardId: string | null;
  panelId: string | null;
  startedAt: string;
  submissionState: "attempted" | "accepted" | "rejected" | "unknown";
  usageStatus: "pending" | "complete" | "partial" | "unavailable";
  providerState: "PENDING" | "RUNNING" | "DONE" | null;
  outcome: "succeeded" | "failed" | "cancelled" | null;
  bytesProcessed: string | null;
  bytesBilled: string | null;
  providerCacheHit: boolean | null;
};

/** Store exact decimal strings: missing usage is not zero and may exceed JS safe integers. */
export function usageBytes(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value)
    ? value.replace(/^0+(?=\d)/, "")
    : null;
}

export function newBigQueryJobUsage(
  projectId: string,
  jobId: string,
  ctx: CredentialContext,
): BigQueryJobUsage {
  const source = attribution.getStore();
  return {
    projectId,
    jobId,
    ownerEmail: ctx.userEmail,
    orgId: ctx.orgId ?? null,
    credentialScope: ctx.credentialScope ?? "default",
    workload: source?.workload ?? "unattributed",
    dashboardId: source?.dashboardId ?? null,
    panelId: source?.panelId ?? null,
    startedAt: new Date().toISOString(),
    submissionState: "attempted",
    usageStatus: "pending",
    providerState: null,
    outcome: null,
    bytesProcessed: null,
    bytesBilled: null,
    providerCacheHit: null,
  };
}

// DDL belongs to the regular migration runner, never a query request.
export const BIGQUERY_USAGE_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS analytics_bigquery_usage (
  project_id TEXT NOT NULL, job_id TEXT NOT NULL, location TEXT,
  owner_email TEXT NOT NULL, org_id TEXT, credential_scope TEXT NOT NULL,
  workload TEXT NOT NULL, dashboard_id TEXT, panel_id TEXT,
  started_at TEXT NOT NULL, observed_at TEXT NOT NULL, submission_state TEXT NOT NULL,
  usage_status TEXT NOT NULL, provider_state TEXT, outcome TEXT,
  bytes_processed TEXT, bytes_billed TEXT, provider_cache_hit BOOLEAN,
  PRIMARY KEY (project_id, job_id)
);
CREATE INDEX IF NOT EXISTS analytics_bigquery_usage_org_started_idx ON analytics_bigquery_usage (org_id, started_at);
CREATE INDEX IF NOT EXISTS analytics_bigquery_usage_owner_started_idx ON analytics_bigquery_usage (owner_email, started_at);`;

/** One row per job: polling and retries of a write cannot add the same spend twice. */
export async function persistBigQueryJobUsage(
  usage: BigQueryJobUsage,
): Promise<boolean> {
  try {
    await getDbExec().execute({
      timeoutMs: 500,
      maxAttempts: 1,
      sql: `INSERT INTO analytics_bigquery_usage (
        project_id, job_id, location, owner_email, org_id, credential_scope, workload, dashboard_id, panel_id,
        started_at, observed_at, submission_state, usage_status, provider_state, outcome,
        bytes_processed, bytes_billed, provider_cache_hit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (project_id, job_id) DO UPDATE SET
        location = EXCLUDED.location, observed_at = EXCLUDED.observed_at,
        submission_state = EXCLUDED.submission_state, usage_status = EXCLUDED.usage_status,
        provider_state = EXCLUDED.provider_state, outcome = EXCLUDED.outcome,
        bytes_processed = EXCLUDED.bytes_processed, bytes_billed = EXCLUDED.bytes_billed,
        provider_cache_hit = EXCLUDED.provider_cache_hit
      WHERE analytics_bigquery_usage.usage_status <> 'complete'
        AND (EXCLUDED.usage_status <> 'pending' OR analytics_bigquery_usage.usage_status = 'pending')`,
      args: [
        usage.projectId,
        usage.jobId,
        usage.location ?? null,
        usage.ownerEmail,
        usage.orgId,
        usage.credentialScope,
        usage.workload,
        usage.dashboardId,
        usage.panelId,
        usage.startedAt,
        new Date().toISOString(),
        usage.submissionState,
        usage.usageStatus,
        usage.providerState,
        usage.outcome,
        usage.bytesProcessed,
        usage.bytesBilled,
        usage.providerCacheHit,
      ],
    });
    return true;
  } catch {
    // Accounting is observational: a database outage must not retry a billable query.
    // Structured identifiers permit recovery without logging SQL, rows or provider errors.
    console.warn("[bigquery-usage] Persistence failed; usage is unknown", {
      projectId: usage.projectId,
      jobId: usage.jobId,
      usageStatus: usage.usageStatus,
    });
    return false;
  }
}

/** Free jobs.get metadata, not another query. Cancellation never proves zero billed bytes. */
export async function observeBigQueryJobUsage(
  usage: BigQueryJobUsage,
  token: string,
  signal?: AbortSignal,
): Promise<BigQueryJobUsage> {
  const result = {
    ...usage,
    usageStatus: "unavailable" as BigQueryJobUsage["usageStatus"],
  };
  try {
    const params = new URLSearchParams({
      fields:
        "jobReference,status,statistics(query(totalBytesProcessed,totalBytesBilled,cacheHit))",
    });
    if (usage.location) params.set("location", usage.location);
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(usage.projectId)}/jobs/${encodeURIComponent(usage.jobId)}?${params}`,
      {
        signal: AbortSignal.any([
          AbortSignal.timeout(1_000),
          ...(signal ? [signal] : []),
        ]),
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return result;
    const data = (await response.json()) as {
      jobReference?: { projectId?: string; jobId?: string; location?: string };
      status?: { state?: string; errorResult?: { reason?: string } };
      statistics?: {
        query?: {
          totalBytesProcessed?: unknown;
          totalBytesBilled?: unknown;
          cacheHit?: unknown;
        };
      };
    };
    // Never attribute metadata for a different job or project to this row.
    if (
      data.jobReference?.projectId !== usage.projectId ||
      data.jobReference.jobId !== usage.jobId
    )
      return result;
    result.submissionState = "accepted";
    result.location = data.jobReference.location ?? usage.location;
    const state = data.status?.state;
    result.providerState =
      state === "DONE" || state === "RUNNING" || state === "PENDING"
        ? state
        : null;
    if (state === "DONE")
      result.outcome = data.status?.errorResult
        ? data.status.errorResult.reason === "stopped"
          ? "cancelled"
          : "failed"
        : "succeeded";
    const stats = data.statistics?.query;
    result.bytesProcessed =
      usageBytes(stats?.totalBytesProcessed) ?? usage.bytesProcessed;
    result.bytesBilled = usageBytes(stats?.totalBytesBilled);
    result.providerCacheHit =
      typeof stats?.cacheHit === "boolean"
        ? stats.cacheHit
        : usage.providerCacheHit;
    result.usageStatus =
      state === "DONE" &&
      result.bytesProcessed !== null &&
      result.bytesBilled !== null &&
      result.providerCacheHit !== null
        ? "complete"
        : "partial";
    return result;
  } catch {
    return result;
  }
}

/** Bounded follow-ups may still leave unknown usage; this is not an invoice or a recurring reconciliation worker. */
export async function finalizeBigQueryJobUsage(
  usage: BigQueryJobUsage,
  token: string,
  initialRecorded: boolean,
  callerSignal?: AbortSignal,
): Promise<BigQueryUsageAccounting> {
  const pending: BigQueryUsageAccounting = {
    projectId: usage.projectId,
    jobId: usage.jobId,
    status: initialRecorded ? "pending" : "unavailable",
  };
  // Accounting must outlive a cancelled query, but never hold its response open.
  const work = retainRequestDbPoolScope(
    (async (): Promise<BigQueryUsageAccounting> => {
      const deadline = AbortSignal.timeout(2_500);
      let observed = { ...usage };
      for (let attempt = 0; attempt < 3 && !deadline.aborted; attempt++) {
        observed = await observeBigQueryJobUsage(observed, token, deadline);
        if (observed.usageStatus === "complete") break;
        if (attempt < 2) {
          try {
            await delay(100, undefined, { signal: deadline });
          } catch {
            break;
          }
        }
      }
      const recorded = await persistBigQueryJobUsage(observed);
      return {
        ...pending,
        status: recorded ? "recorded" : "unavailable",
        usageStatus: observed.usageStatus,
      };
    })().catch((): BigQueryUsageAccounting => {
      console.warn("[bigquery-usage] Finalization failed; usage is unknown", {
        projectId: usage.projectId,
        jobId: usage.jobId,
      });
      return { ...pending, status: "unavailable" };
    }),
  );
  const waitUntil = getRequestRunContext()?.waitUntil ?? platformWaitUntil();
  if (waitUntil) {
    try {
      waitUntil(work);
      return pending;
    } catch {
      console.warn("[bigquery-usage] Background handoff failed", {
        projectId: usage.projectId,
        jobId: usage.jobId,
      });
    }
  }
  // Long-running local workers can finish after this deadline. A serverless freeze
  // may stop them; the initial durable row and pending receipt retain that gap.
  if (callerSignal?.aborted) return pending;
  return new Promise((resolve) => {
    const finish = (receipt: BigQueryUsageAccounting) => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
      resolve(receipt);
    };
    const abort = () => finish(pending);
    const timer = setTimeout(abort, 150);
    callerSignal?.addEventListener("abort", abort, { once: true });
    void work.then(finish);
  });
}
