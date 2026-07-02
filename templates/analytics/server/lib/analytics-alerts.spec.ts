import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  evaluateAnalyticsAlertRuleRows,
  type AnalyticsAlertEventRow,
} from "./analytics-alerts";

function event(
  id: string,
  overrides: Partial<AnalyticsAlertEventRow> = {},
): AnalyticsAlertEventRow {
  return {
    id,
    eventName: "clips_upload_failed",
    userKey: `user_${id}`,
    sessionId: `session_${id}`,
    timestamp: "2026-07-01T12:00:00.000Z",
    app: "clips",
    template: "clips",
    properties: "{}",
    context: "{}",
    ...overrides,
  };
}

describe("analytics alert evaluation", () => {
  it("matches generic columns and nested properties", () => {
    const result = evaluateAnalyticsAlertRuleRows(
      {
        threshold: 2,
        thresholdMode: "event_count",
        distinctBy: null,
        filters: [
          { field: "app", value: "clips" },
          { field: "properties.stage", value: "final_chunk" },
          { field: "properties.status", op: "in", value: [504, "timeout"] },
        ],
      },
      [
        event("1", {
          properties: JSON.stringify({ stage: "final_chunk", status: 504 }),
        }),
        event("2", {
          properties: JSON.stringify({
            stage: "final_chunk",
            status: "timeout",
          }),
        }),
        event("3", {
          properties: JSON.stringify({ stage: "thumbnail", status: 504 }),
        }),
      ],
    );

    expect(result.triggered).toBe(true);
    expect(result.observedValue).toBe(2);
    expect(result.eventCount).toBe(2);
    expect(result.sampleEvents).toHaveLength(2);
  });

  it("can threshold on distinct field values", () => {
    const result = evaluateAnalyticsAlertRuleRows(
      {
        threshold: 2,
        thresholdMode: "distinct_count",
        distinctBy: "user_key",
        filters: [{ field: "event_name", value: "clips_upload_failed" }],
      },
      [
        event("1", { userKey: "alice" }),
        event("2", { userKey: "alice" }),
        event("3", { userKey: "bob" }),
      ],
    );

    expect(result.triggered).toBe(true);
    expect(result.observedValue).toBe(2);
    expect(result.eventCount).toBe(3);
  });

  it("keeps sweep ordering fair instead of cycling only recently evaluated rules", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "case when ${table.lastEvaluatedAt} is null then 0 else 1 end",
    );
    expect(source).toContain("asc(table.lastEvaluatedAt)");
    expect(source).toContain("asc(table.createdAt)");
    expect(source).not.toContain(".orderBy(desc(table.updatedAt))");
    expect(source).toContain(".set(patch)");
    expect(source).not.toContain(".set({ ...patch, updatedAt: nowIso() })");
  });

  it("pages through the full alert window before evaluating filters", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("analyticsAlertEventBatchSize()");
    expect(source).toContain("while (true)");
    expect(source).toContain(".orderBy(desc(table.timestamp), desc(table.id))");
    expect(source).toContain("rows.push(...page)");
    expect(source).toContain("if (page.length < batchSize) break");
    expect(source).not.toContain(".limit(maxCandidateEventsPerRule())");
    expect(source).not.toContain("function maxCandidateEventsPerRule");
  });

  it("claims alert rules before evaluating so parallel sweeps cannot double-send", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const jobSource = readFileSync(
      new URL("../jobs/analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "export async function claimAnalyticsAlertRuleEvaluation",
    );
    expect(source).toContain('lastStatus: "running"');
    expect(source).toContain("alertRuleNotRunningWhere(now)");
    expect(source).toContain("alertRulePreviousEvaluationWhere(rule)");
    expect(source).toContain(".returning({ id: table.id })");
    expect(jobSource).toContain("claimAnalyticsAlertRuleEvaluation(rule)");
    expect(
      jobSource.indexOf("claimAnalyticsAlertRuleEvaluation(rule)"),
    ).toBeLessThan(
      jobSource.indexOf("evaluateAndNotifyAnalyticsAlertRule(rule)"),
    );
  });

  it("keeps triggered rules retryable only when no notification channel delivered", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const noDeliveryIndex = source.indexOf(
      "if (delivery.deliveredChannels.length === 0)",
    );
    const incidentIndex = source.indexOf("recordIncident(rule");

    expect(source).toContain("notifyWithDelivery");
    expect(source).toContain("ensureInboxNotificationChannel(rule.channels)");
    expect(source).toContain("delivery.deliveredChannels.length === 0");
    expect(source).toContain("Analytics alert notification was not delivered.");
    expect(source).toContain('lastStatus: "error"');
    expect(noDeliveryIndex).toBeGreaterThan(-1);
    expect(noDeliveryIndex).toBeLessThan(incidentIndex);
    expect(source).toContain("notificationId: delivery.notification?.id");
    expect(source).not.toContain("if (!stored?.id)");
  });

  it("requires Netlify scheduled invocation payload before forwarding alert cron token", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/emit-netlify-dashboard-report-cron.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const alertTriggerIndex = source.indexOf(
      "function emitAlertScheduledTrigger",
    );
    const alertSource = source.slice(alertTriggerIndex);

    expect(alertSource).toContain("async function readScheduledInvocation");
    expect(alertSource).toContain('request.method !== "POST"');
    expect(alertSource).toContain("body?.next_run");
    expect(alertSource).toContain(
      'if (!scheduled) return new Response("Not Found", { status: 404 });',
    );
    expect(
      alertSource.indexOf("readScheduledInvocation(request)"),
    ).toBeLessThan(
      alertSource.indexOf('"x-agent-native-analytics-alert-cron": CRON_TOKEN'),
    );
  });
});
