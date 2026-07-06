import {
  claimAnalyticsAlertRuleEvaluation,
  ensureDefaultHttp5xxSpikeAlertRules,
  evaluateAndNotifyAnalyticsAlertRule,
  listEnabledAnalyticsAlertRules,
  markAnalyticsAlertRuleError,
} from "../lib/analytics-alerts";

let running = false;
let listRulesFailureLogged = false;
const DEFAULT_MAX_RULES_PER_SWEEP = 100;

function maxRulesPerSweep(input?: number): number {
  if (input) return Math.max(1, Math.min(500, Math.floor(input)));
  const raw = process.env.ANALYTICS_ALERT_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_RULES_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_RULES_PER_SWEEP;
}

/**
 * Run one analytics alert sweep. Exported for deployment-specific scheduled
 * functions that should not rely on a long-lived Node process.
 */
export async function runAnalyticsAlertsOnce(
  options: {
    ownerEmail?: string;
    orgId?: string | null;
    limit?: number;
  } = {},
): Promise<{
  processed: number;
  triggered: number;
  failed: number;
  remaining: number;
}> {
  if (running) return { processed: 0, triggered: 0, failed: 0, remaining: 0 };
  running = true;
  let processed = 0;
  let triggered = 0;
  let failed = 0;
  let remaining = 0;

  try {
    const sweepLimit = maxRulesPerSweep(options.limit);
    await ensureDefaultHttp5xxSpikeAlertRules().catch((err) => {
      console.error("[analytics-alerts] Default 5xx alert seed failed:", err);
    });
    let rules: Awaited<ReturnType<typeof listEnabledAnalyticsAlertRules>>;
    try {
      rules = await listEnabledAnalyticsAlertRules({
        limit: sweepLimit,
        ownerEmail: options.ownerEmail,
        orgId: options.orgId,
      });
    } catch (err) {
      // Schema not migrated yet (e.g. a deploy that hasn't picked up the
      // analytics_alert_rules migration) or a transient DB error — don't let
      // one bad sweep crash the whole interval/cron invocation every time it
      // fires. Log once per process so the failure is still visible.
      if (!listRulesFailureLogged) {
        console.error(
          "[analytics-alerts] Failed to list enabled alert rules; skipping this sweep:",
          err,
        );
        listRulesFailureLogged = true;
      }
      return { processed: 0, triggered: 0, failed: 0, remaining: 0 };
    }
    listRulesFailureLogged = false;
    remaining = rules.length >= sweepLimit ? 1 : 0;

    for (const rule of rules) {
      try {
        const claimed = await claimAnalyticsAlertRuleEvaluation(rule);
        if (!claimed) continue;
        processed++;
        const result = await evaluateAndNotifyAnalyticsAlertRule(rule);
        if (result.status === "triggered") triggered++;
      } catch (err) {
        failed++;
        await markAnalyticsAlertRuleError(rule.id, err).catch(() => {});
        console.error(
          `[analytics-alerts] Rule ${rule.id} (${rule.name}) failed:`,
          err,
        );
      }
    }
  } finally {
    running = false;
  }

  return { processed, triggered, failed, remaining };
}
