import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { sendDashboardReportSubscription } from "../lib/dashboard-report";
import {
  claimDueDashboardReportSubscriptions,
  dashboardReportRetryAt,
  markDashboardReportResult,
  recordDashboardReportCaptureOutcome,
} from "../lib/dashboard-report-subscriptions";

let running = false;
const DEFAULT_MAX_REPORTS_PER_SWEEP = 5;
const SERVERLESS_REPORT_DELIVERY_BUDGET_MS = 220_000;
/**
 * Reports render from SQL in seconds now, so one sweep can drain the whole
 * batch. When capture still drove a headless browser this was forced to 1 and
 * every subscription after the first missed its same-day retry window.
 */
const SERVERLESS_MAX_REPORTS_PER_SWEEP = 5;

async function persistDashboardReportResult(
  ...args: Parameters<typeof markDashboardReportResult>
): Promise<boolean> {
  try {
    await markDashboardReportResult(...args);
    return true;
  } catch (err) {
    console.error(
      `[dashboard-report] Failed to persist subscription ${args[0].id} result:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

async function persistDashboardReportCaptureOutcome(
  ...args: Parameters<typeof recordDashboardReportCaptureOutcome>
): Promise<void> {
  try {
    const persisted = await recordDashboardReportCaptureOutcome(...args);
    if (!persisted) {
      console.warn(
        `[dashboard-report] Capture checkpoint was superseded for subscription ${args[0].id}`,
      );
    }
  } catch (err) {
    console.error(
      `[dashboard-report] Failed to persist capture checkpoint for subscription ${args[0].id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function maxReportsPerSweep(): number {
  if (process.env.NETLIFY === "true") return SERVERLESS_MAX_REPORTS_PER_SWEEP;
  const raw = process.env.DASHBOARD_REPORT_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_REPORTS_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_REPORTS_PER_SWEEP;
}

/**
 * Run one dashboard report sweep. Exported for deployment-specific scheduled
 * functions that should not rely on a long-lived Node process.
 */
export async function runDashboardReportsOnce(): Promise<{
  processed: number;
  failed: number;
  remaining: number;
}> {
  if (running) return { processed: 0, failed: 0, remaining: 0 };
  running = true;
  const deliveryDeadlineAt =
    process.env.NETLIFY === "true"
      ? Date.now() + SERVERLESS_REPORT_DELIVERY_BUDGET_MS
      : undefined;
  let processed = 0;
  let failed = 0;
  let remaining = 0;

  try {
    const sweepLimit = maxReportsPerSweep();
    const batch = await claimDueDashboardReportSubscriptions(sweepLimit);
    remaining = batch.length >= sweepLimit ? 1 : 0;
    for (const sub of batch) {
      processed++;
      try {
        const retryAt = dashboardReportRetryAt(sub);
        const result = await runWithRequestContext(
          {
            userEmail: sub.ownerEmail,
            orgId: sub.orgId ?? undefined,
          },
          () =>
            sendDashboardReportSubscription(sub, {
              skipEmailWhenDegraded: retryAt !== null,
              onCaptureOutcome: (outcome) =>
                persistDashboardReportCaptureOutcome(sub, outcome),
              ...(deliveryDeadlineAt ? { deadlineAt: deliveryDeadlineAt } : {}),
            }),
        );
        const degradedReason =
          result.reportError ??
          `panels unavailable: ${result.degradedPanelIds.join(", ") || "unknown"}`;

        if (!result.emailsSent) {
          console.error(
            `[dashboard-report] Subscription ${sub.id} held back a degraded report, will retry:`,
            degradedReason,
          );
          const message = `${degradedReason} (retry scheduled)`;
          const persisted = retryAt
            ? await persistDashboardReportResult(sub, "error", message, {
                nextRunAt: retryAt,
              })
            : await persistDashboardReportResult(sub, "error", message);
          if (!persisted) failed++;
          continue;
        }

        if (result.reportMode === "degraded") {
          failed++;
          console.error(
            `[dashboard-report] Subscription ${sub.id} sent a degraded report:`,
            degradedReason,
          );
          await persistDashboardReportResult(sub, "error", degradedReason);
          continue;
        }

        if (!(await persistDashboardReportResult(sub, "success"))) failed++;
      } catch (err: any) {
        failed++;
        const message = err?.message ?? String(err);
        console.error(
          `[dashboard-report] Subscription ${sub.id} failed:`,
          message,
        );
        await persistDashboardReportResult(sub, "error", message);
      }
    }
  } finally {
    running = false;
  }

  return { processed, failed, remaining };
}
