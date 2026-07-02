import {
  claimAnalyticsAlertRuleEvaluation,
  evaluateAndNotifyAnalyticsAlertRule,
  listEnabledAnalyticsAlertRules,
  markAnalyticsAlertRuleError,
} from "../lib/analytics-alerts";

let running = false;
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
    const rules = await listEnabledAnalyticsAlertRules({
      limit: sweepLimit,
      ownerEmail: options.ownerEmail,
      orgId: options.orgId,
    });
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
