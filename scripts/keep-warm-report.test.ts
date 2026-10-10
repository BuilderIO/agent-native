import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acknowledgeHealthNotification,
  extractFailureDetails,
  initialHealthReportState,
  parseHealthReportState,
  planHealthReport,
  renderDegradedHealthNotification,
  renderHealthNotification,
  type HealthReportInput,
  type HealthReportState,
} from "./keep-warm-report.ts";

const runUrl = "https://github.com/BuilderIO/agent-native/actions/runs/123";
const failureLog = "✓ app-one (200) in 38ms\n✗ app-two (503) in 203ms";
const failureUpdatedAt = "2026-10-10T10:00:00Z";

function plan(
  overrides: Partial<HealthReportInput> = {},
  state: HealthReportState = initialHealthReportState(),
) {
  return planHealthReport({
    state,
    healthOutcome: "failure",
    eventName: "schedule",
    historyRead: "ok",
    observedAt: failureUpdatedAt,
    runId: "123",
    runAttempt: "1",
    runUrl,
    failingLog: failureLog,
    ...overrides,
  });
}

test("scheduled failure waits for confirmation, then queues one incident report", () => {
  const first = plan();
  assert.equal(first.state.incidentActive, false);
  assert.equal(first.notification, null);

  const confirmed = plan(
    {
      observedAt: "2026-10-10T10:15:00Z",
      runId: "124",
    },
    first.state,
  );
  assert.equal(confirmed.state.incidentActive, true);
  assert.equal(confirmed.notification?.kind, "incident");
  assert.equal(confirmed.notification?.id, "124-1-incident");
  assert.equal(confirmed.state.pendingNotifications.length, 1);
});

test("repeated failures keep the incident report deduplicated", () => {
  const firstFailure = plan();
  const confirmed = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  );
  const active = acknowledgeHealthNotification(
    confirmed.state,
    confirmed.state.pendingNotifications[0]!.id,
  );
  const repeated = plan(
    { observedAt: "2026-10-10T10:30:00Z", runId: "125" },
    active,
  );

  assert.equal(repeated.state.incidentActive, true);
  assert.equal(repeated.state.pendingNotifications.length, 0);
  assert.equal(repeated.notification, null);
});

test("a changed failure signature queues one update with current details", () => {
  const firstFailure = plan();
  const incident = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  );
  const active = acknowledgeHealthNotification(
    incident.state,
    incident.notification!.id,
  );
  const changedLog =
    "✓ app-one (200) in 38ms\n✗ app-two (503) in 203ms\n✗ app-three (502) in 89ms";
  const update = plan(
    {
      observedAt: "2026-10-10T10:30:00Z",
      runId: "125",
      failingLog: changedLog,
    },
    active,
  );
  assert.equal(update.notification?.kind, "incident-update");
  assert.match(update.notification?.failing ?? "", /app-three/);
  assert.notEqual(
    update.notification?.signature,
    incident.notification?.signature,
  );
  assert.match(
    renderHealthNotification(update.notification!),
    /incident updated/i,
  );

  const repeated = plan(
    {
      observedAt: "2026-10-10T10:45:00Z",
      runId: "126",
      failingLog: changedLog.replace("203ms", "981ms").replace("89ms", "902ms"),
    },
    update.state,
  );
  assert.equal(repeated.notification?.id, update.notification?.id);
  assert.equal(repeated.state.pendingNotifications.length, 1);
});

test("a pending incident update coalesces to the latest failure details", () => {
  const firstFailure = plan();
  const incident = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  );
  const firstUpdate = plan(
    {
      observedAt: "2026-10-10T10:30:00Z",
      runId: "125",
      failingLog: `${failureLog}\n✗ app-three (502) in 89ms`,
    },
    incident.state,
  );
  const latestUpdate = plan(
    {
      observedAt: "2026-10-10T10:45:00Z",
      runId: "126",
      failingLog: `${failureLog}\n✗ app-four (500) in 89ms`,
    },
    firstUpdate.state,
  );

  assert.equal(latestUpdate.state.pendingNotifications.length, 2);
  assert.equal(
    latestUpdate.state.pendingNotifications[1]?.kind,
    "incident-update",
  );
  assert.match(
    latestUpdate.state.pendingNotifications[1]?.failing ?? "",
    /app-four/,
  );
  assert.doesNotMatch(
    latestUpdate.state.pendingNotifications[1]?.failing ?? "",
    /app-three/,
  );
});

test("manual failures report immediately, including when history is unavailable", () => {
  const result = plan({
    eventName: "workflow_dispatch",
    historyRead: "unavailable",
  });
  assert.equal(result.state.incidentActive, true);
  assert.equal(result.notification?.kind, "incident");
});

test("scheduled recovery waits for two clean audits after the last failure", () => {
  const firstFailure = plan();
  const active = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  ).state;
  const firstClean = plan(
    {
      healthOutcome: "success",
      observedAt: "2026-10-10T10:30:00Z",
      runId: "125",
      failingLog: "",
    },
    active,
  );
  assert.equal(firstClean.state.incidentActive, true);
  assert.equal(firstClean.notification?.kind, "incident");

  const recovered = plan(
    {
      healthOutcome: "success",
      observedAt: "2026-10-10T10:45:00Z",
      runId: "126",
      failingLog: "",
    },
    firstClean.state,
  );
  assert.equal(recovered.state.incidentActive, false);
  assert.equal(recovered.notification?.kind, "incident");
  assert.equal(recovered.state.pendingNotifications[1]?.kind, "recovery");
});

test("manual success recovers an active incident immediately", () => {
  const firstFailure = plan();
  const active = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  ).state;
  const recovered = plan(
    {
      healthOutcome: "success",
      eventName: "workflow_dispatch",
      observedAt: "2026-10-10T10:30:00Z",
      runId: "125",
      failingLog: "",
    },
    active,
  );
  assert.equal(recovered.state.incidentActive, false);
  assert.equal(recovered.state.pendingNotifications[1]?.kind, "recovery");
});

test("pending Slack notifications remain retryable until acknowledged", () => {
  const firstFailure = plan();
  const active = plan(
    { observedAt: "2026-10-10T10:15:00Z", runId: "124" },
    firstFailure.state,
  ).state;
  const notification = active.pendingNotifications[0]!;
  const retry = plan(
    {
      healthOutcome: "success",
      observedAt: "2026-10-10T10:30:00Z",
      runId: "125",
      failingLog: "",
    },
    active,
  );
  const acknowledged = acknowledgeHealthNotification(active, notification.id);

  assert.equal(acknowledged.incidentActive, true);
  assert.deepEqual(acknowledged.pendingNotifications, []);
  assert.equal(retry.notification?.id, notification.id);
  assert.match(
    renderHealthNotification(notification),
    /Production health incident/,
  );
  assert.throws(
    () => acknowledgeHealthNotification(acknowledged, notification.id),
    /not pending/,
  );
});

test("reporting failures do not count as scheduled health failures", () => {
  const lastHealthy = plan({
    healthOutcome: "success",
    observedAt: "2026-10-10T10:00:00Z",
    failingLog: "",
  }).state;
  const next = plan(
    {
      observedAt: "2026-10-10T10:15:00Z",
      runId: "124",
    },
    lastHealthy,
  );

  assert.equal(next.state.incidentActive, false);
  assert.equal(next.notification, null);
});

test("failure deduplication ignores changing latency and count digits", () => {
  const first = extractFailureDetails("✗ app-two (503) in 203ms");
  const repeated = extractFailureDetails("✗ app-two (503) in 981ms");
  assert.equal(first.signature, repeated.signature);
});

test("health report counts all findings and reports overflow beyond the Slack cap", () => {
  const manyFailures = Array.from(
    { length: 120 },
    (_, index) =>
      `✗ app-${index.toString().padStart(3, "0")} (${500 + index}) ${"x".repeat(60)}`,
  ).join("\n");
  const details = extractFailureDetails(manyFailures);
  assert.equal(details.totalFindings, 120);
  assert.ok(details.omittedFindings > 0);

  const result = plan({
    failingLog: manyFailures,
    eventName: "workflow_dispatch",
  });
  const rendered = renderHealthNotification(result.notification!);
  assert.match(rendered, /Findings: 120 total; showing \d+; \d+ omitted/);
  assert.match(
    rendered,
    /additional failing checks are in the full report artifact/,
  );
});

test("a single oversized health detail is counted as visible and flagged as truncated", () => {
  const result = plan({
    eventName: "workflow_dispatch",
    failingLog: `✗ app-one ${"detail ".repeat(1_000)}`,
  });

  assert.equal(result.totalFindings, 1);
  assert.equal(result.omittedFindings, 0);
  assert.equal(result.detailsTruncated, true);
  assert.match(
    renderHealthNotification(result.notification!),
    /failure detail was truncated/i,
  );
});

test("degraded state reads report findings, unknown history, and artifact fallback", () => {
  const rendered = renderDegradedHealthNotification({
    healthOutcome: "failure",
    historyRead: "unavailable",
    runUrl,
    failingLog: "✗ app-two (503) in 203ms",
    reportArtifactUrl:
      "https://github.com/BuilderIO/agent-native/actions/runs/123/artifacts/456",
  });
  assert.match(rendered, /deduplication and incident history are unknown/i);
  assert.match(rendered, /Findings: 1 total; showing 1; 0 omitted/);
  assert.match(rendered, /90-day health report artifact/);
});

test("state parsing fails loudly for absent or malformed artifact data", () => {
  assert.throws(() => parseHealthReportState("not-json"), /not valid JSON/);
  assert.throws(() => parseHealthReportState("{}"), /unsupported version/);
});
