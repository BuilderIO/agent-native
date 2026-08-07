import { notifyWithDelivery } from "@agent-native/core/notifications";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

import { sendDashboardReportSubscription } from "../lib/dashboard-report";
import {
  claimDueDashboardReportSubscriptions,
  dashboardReportRetryAt,
  markDashboardReportResult,
  recordDashboardReportCaptureOutcome,
} from "../lib/dashboard-report-subscriptions";

declare global {
  var __AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__: boolean | undefined;
}

let running = false;
const DEFAULT_MAX_REPORTS_PER_SWEEP = 5;
// Bounds snapshot/panel/render work per subscription. Originally only applied
// in serverless mode to fit the function's execution limit; it now also
// backstops the long-running in-process cron, where a hung query or render
// call would otherwise leave `running` stuck forever instead of just
// delaying the next sweep.
const SERVERLESS_REPORT_DELIVERY_BUDGET_MS = 220_000;
const SERVERLESS_MAX_REPORTS_PER_SWEEP = 1;

function serverlessDashboardReportRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    globalThis.__AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__ === true
  );
}

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

/**
 * Tell the owner when a scheduled report is finally given up on. Retries stay
 * silent — only an exhausted retry window means the report they expected will
 * never arrive, and a log line alone leaves them waiting on nothing.
 */
async function notifyDashboardReportGaveUp(
  sub: {
    id: string;
    ownerEmail: string;
    orgId?: string | null;
    dashboardId?: string;
  },
  reason: string,
): Promise<void> {
  try {
    await notifyWithDelivery(
      {
        severity: "warning",
        title: "Scheduled dashboard report failed",
        body: `The scheduled report for subscription ${sub.id} could not be delivered: ${reason}`,
        channels: ["inbox", "email"],
        metadata: {
          kind: "dashboard_report_failure",
          subscriptionId: sub.id,
          path: "/dashboard-reports",
          // The email channel is a no-op without explicit recipients.
          emailRecipients: [sub.ownerEmail],
          emailSubject: "Your scheduled dashboard report did not send",
        },
      },
      { owner: sub.ownerEmail },
    );
  } catch (err) {
    console.error(
      `[dashboard-report] Could not notify owner of subscription ${sub.id} about the failure:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function maxReportsPerSweep(): number {
  if (serverlessDashboardReportRuntime()) {
    return SERVERLESS_MAX_REPORTS_PER_SWEEP;
  }
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
  let processed = 0;
  let failed = 0;
  let remaining = 0;

  try {
    const sweepLimit = maxReportsPerSweep();
    const batch = await claimDueDashboardReportSubscriptions(sweepLimit);
    remaining = batch.length >= sweepLimit ? 1 : 0;
    for (const sub of batch) {
      processed++;
      const deliveryDeadlineAt =
        Date.now() + SERVERLESS_REPORT_DELIVERY_BUDGET_MS;
      const retryAt = dashboardReportRetryAt(sub);
      try {
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
          failed++;
          const retryMessage = retryAt
            ? `${degradedReason} (retry scheduled)`
            : degradedReason;
          console.error(
            `[dashboard-report] Subscription ${sub.id} held back a degraded report${retryAt ? ", will retry" : ""}:`,
            degradedReason,
          );
          if (retryAt) {
            await persistDashboardReportResult(sub, "error", retryMessage, {
              nextRunAt: retryAt,
            });
          } else {
            await persistDashboardReportResult(sub, "error", retryMessage);
            await notifyDashboardReportGaveUp(sub, degradedReason);
          }
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
        if (retryAt) {
          await persistDashboardReportResult(sub, "error", message, {
            nextRunAt: retryAt,
          });
        } else {
          await persistDashboardReportResult(sub, "error", message);
          await notifyDashboardReportGaveUp(sub, message);
        }
      }
    }
  } finally {
    running = false;
  }

  return { processed, failed, remaining };
}
