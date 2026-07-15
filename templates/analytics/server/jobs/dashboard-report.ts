import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { sendDashboardReportSubscription } from "../lib/dashboard-report";
import {
  claimDueDashboardReportSubscriptions,
  dashboardReportRetryAt,
  markDashboardReportResult,
} from "../lib/dashboard-report-subscriptions";

let running = false;
const DEFAULT_MAX_REPORTS_PER_SWEEP = 5;

function maxReportsPerSweep(): number {
  const raw = process.env.DASHBOARD_REPORT_SWEEP_LIMIT?.trim();
  if (!raw && process.env.NETLIFY === "true") return 1;
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
              allowLimitedFallback: retryAt === null,
            }),
        );
        if (!result.screenshotAttached) {
          const message = result.screenshotError
            ? `Dashboard screenshot unavailable: ${result.screenshotError}`
            : "Dashboard screenshot unavailable";
          if (retryAt && !result.emailsSent) {
            console.error(
              `[dashboard-report] Subscription ${sub.id} skipped sending without a screenshot, will retry:`,
              message,
            );
            await markDashboardReportResult(
              sub,
              "error",
              `${message} (retry scheduled)`,
              { nextRunAt: retryAt },
            );
            continue;
          }
          failed++;
          console.error(
            `[dashboard-report] Subscription ${sub.id} sent without a screenshot:`,
            message,
          );
          await markDashboardReportResult(sub, "error", message);
          continue;
        }
        if (result.screenshotMode !== "full" && result.screenshotError) {
          const detail = `sent with ${result.screenshotMode} screenshot; earlier attempts failed: ${result.screenshotError}`;
          console.warn(`[dashboard-report] Subscription ${sub.id} ${detail}`);
          await markDashboardReportResult(sub, "success", detail);
        } else {
          await markDashboardReportResult(sub, "success");
        }
      } catch (err: any) {
        failed++;
        const message = err?.message ?? String(err);
        console.error(
          `[dashboard-report] Subscription ${sub.id} failed:`,
          message,
        );
        await markDashboardReportResult(sub, "error", message);
      }
    }
  } finally {
    running = false;
  }

  return { processed, failed, remaining };
}
