import { runWithRequestContext } from "@agent-native/core/server";

import {
  claimAnalyticsAlertRuleEvaluation,
  ensureDefaultAnalyticsAlertRules,
  evaluateAndNotifyAnalyticsAlertRule,
  evaluateBigQueryAnalyticsAlertBatch,
  isBigQueryAnalyticsAlertBatchEligible,
  listEnabledAnalyticsAlertRules,
  markAnalyticsAlertRuleError,
  type AnalyticsAlertRule,
  type AnalyticsAlertEvaluation,
} from "../lib/analytics-alerts";
import { getFirstPartyAnalyticsBackend } from "../lib/first-party-analytics-backend.js";

let running = false;
let listRulesFailureLogged = false;
const DEFAULT_MAX_RULES_PER_SWEEP = 100;
const MAX_BIGQUERY_RULES_PER_BATCH = 3;
const PRIORITY_BIGQUERY_EVENTS = new Set([
  "agent_run_terminal",
  "agent_chat_stuck_detected",
  "http.response",
]);

function prioritizeBigQueryRules(
  rules: AnalyticsAlertRule[],
): AnalyticsAlertRule[] {
  const pending = new Set(PRIORITY_BIGQUERY_EVENTS);
  const priority: AnalyticsAlertRule[] = [];
  const remaining: AnalyticsAlertRule[] = [];
  for (const rule of rules) {
    if (rule.eventName && pending.delete(rule.eventName)) priority.push(rule);
    else remaining.push(rule);
  }
  return [...priority, ...remaining];
}

function maxRulesPerSweep(input?: number): number {
  if (input) return Math.max(1, Math.min(500, Math.floor(input)));
  const raw = process.env.ANALYTICS_ALERT_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_RULES_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_RULES_PER_SWEEP;
}

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
    await ensureDefaultAnalyticsAlertRules().catch((err) => {
      console.error("[analytics-alerts] Default alert seed failed:", err);
    });
    let rules: Awaited<ReturnType<typeof listEnabledAnalyticsAlertRules>>;
    try {
      rules = await listEnabledAnalyticsAlertRules({
        limit: sweepLimit,
        ownerEmail: options.ownerEmail,
        orgId: options.orgId,
      });
    } catch (err) {
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

    async function failRule(rule: AnalyticsAlertRule, err: unknown) {
      failed++;
      try {
        await markAnalyticsAlertRuleError(rule.id, err);
      } catch (statusError) {
        console.error(
          `[analytics-alerts] Failed to mark rule ${rule.id} error:`,
          statusError,
        );
      }
      console.error(
        `[analytics-alerts] Rule ${rule.id} (${rule.name}) failed:`,
        err,
      );
    }

    async function claimRule(rule: AnalyticsAlertRule): Promise<boolean> {
      try {
        const claimed = await claimAnalyticsAlertRuleEvaluation(rule);
        if (claimed) processed++;
        return claimed;
      } catch (err) {
        await failRule(rule, err);
        return false;
      }
    }

    const batches = new Map<string, AnalyticsAlertRule[]>();
    const individualRules: AnalyticsAlertRule[] = [];
    for (const rule of rules) {
      try {
        if (!isBigQueryAnalyticsAlertBatchEligible(rule)) {
          individualRules.push(rule);
          continue;
        }
        const backend = await runWithRequestContext(
          {
            userEmail: rule.ownerEmail,
            ...(rule.orgId !== null ? { orgId: rule.orgId } : {}),
          },
          () =>
            getFirstPartyAnalyticsBackend({
              userEmail: rule.ownerEmail,
              orgId: rule.orgId,
            }),
        );
        if (backend.sink !== "bigquery") {
          individualRules.push(rule);
          continue;
        }
        const key = JSON.stringify([rule.ownerEmail, rule.orgId]);
        const batch = batches.get(key);
        if (batch) batch.push(rule);
        else batches.set(key, [rule]);
      } catch (err) {
        if (await claimRule(rule)) await failRule(rule, err);
      }
    }

    async function notifyRule(
      rule: AnalyticsAlertRule,
      now: Date,
      evaluation?: AnalyticsAlertEvaluation,
    ) {
      try {
        const result = await evaluateAndNotifyAnalyticsAlertRule(
          rule,
          now,
          evaluation,
        );
        if (result.status === "triggered") triggered++;
        if (result.status === "error") failed++;
      } catch (err) {
        await failRule(rule, err);
      }
    }

    for (const rules of batches.values()) {
      const scopedRules = prioritizeBigQueryRules(rules);
      for (
        let offset = 0;
        offset < scopedRules.length;
        offset += MAX_BIGQUERY_RULES_PER_BATCH
      ) {
        const plannedBatch = scopedRules.slice(
          offset,
          offset + MAX_BIGQUERY_RULES_PER_BATCH,
        );
        const batch: AnalyticsAlertRule[] = [];
        for (const rule of plannedBatch) {
          if (await claimRule(rule)) batch.push(rule);
        }
        if (!batch.length) continue;
        const now = new Date();
        let evaluations: Awaited<
          ReturnType<typeof evaluateBigQueryAnalyticsAlertBatch>
        >;
        try {
          evaluations = await evaluateBigQueryAnalyticsAlertBatch(batch, now);
        } catch (err) {
          for (const rule of batch) await failRule(rule, err);
          continue;
        }
        for (const rule of batch) {
          const result = evaluations.get(rule.id);
          if (!result) {
            await failRule(
              rule,
              new Error(`Missing analytics alert batch result: ${rule.id}`),
            );
          } else if ("error" in result) {
            await failRule(rule, result.error);
          } else {
            await notifyRule(rule, now, result.evaluation);
          }
        }
      }
    }
    for (const rule of individualRules) {
      if (await claimRule(rule)) await notifyRule(rule, new Date());
    }
  } finally {
    running = false;
  }

  return { processed, triggered, failed, remaining };
}
