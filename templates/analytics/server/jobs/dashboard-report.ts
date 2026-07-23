import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { sendDashboardReportSubscription } from "../lib/dashboard-report";
import {
  claimDueDashboardReportSubscriptions,
  dashboardReportRetryAt,
  markDashboardReportResult,
} from "../lib/dashboard-report-subscriptions";

let running = false;
const DEFAULT_MAX_REPORTS_PER_SWEEP = 5;
const SERVERLESS_REPORT_DELIVERY_BUDGET_MS = 220_000;

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

function maxReportsPerSweep(): number {
  if (process.env.NETLIFY === "true") return 1;
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
              skipEmailWithoutScreenshot: retryAt !== null,
              ...(deliveryDeadlineAt ? { deadlineAt: deliveryDeadlineAt } : {}),
            }),
        );
        if (result.screenshotMode === "partial" && result.emailsSent) {
          failed++;
          const message = result.screenshotError
            ? `Dashboard screenshot partially available: ${result.screenshotError}`
            : "Dashboard screenshot partially available";
          console.error(
            `[dashboard-report] Subscription ${sub.id} sent with a partial screenshot:`,
            message,
          );
          await persistDashboardReportResult(sub, "error", message);
          continue;
        }
        if (!result.screenshotAttached) {
          const message = result.screenshotError
            ? `Dashboard screenshot unavailable: ${result.screenshotError}`
            : "Dashboard screenshot unavailable";
          if (retryAt && !result.emailsSent) {
            console.error(
              `[dashboard-report] Subscription ${sub.id} skipped sending without a screenshot, will retry:`,
              message,
            );
            const persisted = await persistDashboardReportResult(
              sub,
              "error",
              `${message} (retry scheduled)`,
              { nextRunAt: retryAt },
            );
            if (!persisted) failed++;
            continue;
          }
          failed++;
          console.error(
            `[dashboard-report] Subscription ${sub.id} sent without a screenshot:`,
            message,
          );
          await persistDashboardReportResult(sub, "error", message);
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
