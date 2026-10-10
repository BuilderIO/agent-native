import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialSignupAgentReportState,
  initialSignupE2EReportState,
  assertLegacySignupReportFallbackAllowed,
  finalizeSignupAgentReport,
  finalizeSignupE2EReport,
  parseSignupAgentReportState,
  parseSignupE2EReportState,
  planSignupAgentReport,
  planSignupE2EReport,
  renderSignupAgentRecovery,
  renderSignupE2ERecovery,
} from "./signup-report-continuity.ts";

const runUrl = "https://github.com/BuilderIO/agent-native/actions/runs/123";
const priorRunUrl =
  "https://github.com/BuilderIO/agent-native/actions/runs/100";
const artifactUrl = `${runUrl}/artifacts/456`;
const priorArtifactUrl = `${priorRunUrl}/artifacts/789`;

test("legacy signup report fallback is allowed only when the persist step is absent", () => {
  assert.doesNotThrow(() =>
    assertLegacySignupReportFallbackAllowed(
      JSON.stringify({
        jobs: [{ steps: [{ name: "Build report", conclusion: "success" }] }],
      }),
      "Persist Signup E2E continuity state",
    ),
  );

  for (const conclusion of [
    "skipped",
    "success",
    "failure",
    "action_required",
  ]) {
    assert.throws(
      () =>
        assertLegacySignupReportFallbackAllowed(
          JSON.stringify({
            jobs: [
              {
                steps: [
                  {
                    name: "Persist Signup agent continuity state",
                    conclusion,
                  },
                ],
              },
            ],
          }),
          "Persist Signup agent continuity state",
        ),
      /continuity artifact is missing; refusing to fall back to legacy report state/,
    );
  }

  assert.throws(
    () => assertLegacySignupReportFallbackAllowed("{}", "Persist state"),
    /invalid shape/,
  );
});

test("signup E2E emits one recovery after a failed scheduled report passes", () => {
  const failed = planSignupE2EReport({
    previous: initialSignupE2EReportState(),
    eventName: "schedule",
    outcome: "failure",
    findingCount: 2,
    runUrl: priorRunUrl,
    reportArtifactUrl: priorArtifactUrl,
  });

  const recovered = planSignupE2EReport({
    previous: failed.state,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });

  assert.equal(recovered.recovery?.findingCount, 2);
  assert.equal(recovered.state.outcome, "clean");
  const message = renderSignupE2ERecovery({
    recovery: recovered.recovery!,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });
  assert.match(message, /Signup E2E recovered/);
  assert.match(message, /cleared 2 findings/);
  assert.match(message, /previous report artifact/);
  assert.match(message, /test-result artifact/);

  const nextClean = planSignupE2EReport({
    previous: recovered.state,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    runUrl: `${runUrl}1`,
  });
  assert.equal(nextClean.recovery, null);

  assert.deepEqual(
    finalizeSignupE2EReport({
      previous: failed.state,
      plan: recovered,
      slackDelivered: false,
    }),
    failed.state,
  );
  assert.deepEqual(
    finalizeSignupE2EReport({
      previous: failed.state,
      plan: recovered,
      slackDelivered: true,
    }),
    recovered.state,
  );
});

test("signup E2E inconclusive and manual runs preserve scheduled failure state", () => {
  const failed = {
    ...initialSignupE2EReportState(),
    outcome: "failure" as const,
    findingCount: 1,
    runUrl: priorRunUrl,
  };
  const inconclusive = planSignupE2EReport({
    previous: failed,
    eventName: "schedule",
    outcome: "inconclusive",
    findingCount: 0,
    runUrl,
  });
  assert.deepEqual(inconclusive.state, failed);
  assert.equal(inconclusive.recovery, null);

  const manualPass = planSignupE2EReport({
    previous: failed,
    eventName: "workflow_dispatch",
    outcome: "clean",
    findingCount: 0,
    runUrl,
  });
  assert.deepEqual(manualPass.state, failed);
  assert.equal(manualPass.recovery, null);
});

test("signup E2E state parsing rejects corrupt or foreign state", () => {
  assert.throws(() => parseSignupE2EReportState(""), /not valid JSON/);
  assert.throws(
    () =>
      parseSignupE2EReportState(
        JSON.stringify({ ...initialSignupE2EReportState(), outcome: "maybe" }),
      ),
    /invalid shape/,
  );
  assert.throws(
    () =>
      parseSignupE2EReportState(
        JSON.stringify({
          ...initialSignupE2EReportState(),
          runUrl: "https://evil.test/run",
        }),
      ),
    /invalid shape/,
  );
  assert.throws(
    () =>
      planSignupE2EReport({
        previous: initialSignupE2EReportState(),
        eventName: "schedule",
        outcome: "not-clean" as "clean",
        findingCount: 0,
        runUrl,
      }),
    /outcome is invalid/,
  );
});

test("signup E2E does not persist an undelivered failure", () => {
  const previous = initialSignupE2EReportState();
  const failure = planSignupE2EReport({
    previous,
    eventName: "schedule",
    outcome: "failure",
    findingCount: 1,
    runUrl,
  });

  assert.deepEqual(
    finalizeSignupE2EReport({ previous, plan: failure, slackDelivered: false }),
    previous,
  );
});

test("signup agent clears all prior findings in one complete clean rollup", () => {
  const findings = planSignupAgentReport({
    previous: initialSignupAgentReportState(),
    eventName: "schedule",
    outcome: "findings",
    findingCount: 3,
    reportComplete: true,
    runUrl: priorRunUrl,
    reportArtifactUrl: priorArtifactUrl,
  });
  const cleared = planSignupAgentReport({
    previous: findings.state,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    reportComplete: true,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });

  assert.equal(cleared.recovery?.findingCount, 3);
  assert.equal(cleared.state.outcome, "clean");
  const message = renderSignupAgentRecovery({
    recovery: cleared.recovery!,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });
  assert.match(message, /Signup agent findings cleared/);
  assert.match(message, /cleared 3 findings/);
  assert.match(message, /current report artifact/);
  assert.equal((message.match(/cleared 3 findings/g) ?? []).length, 1);

  const nextClean = planSignupAgentReport({
    previous: cleared.state,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    reportComplete: true,
    runUrl: `${runUrl}1`,
  });
  assert.equal(nextClean.recovery, null);

  assert.deepEqual(
    finalizeSignupAgentReport({
      previous: findings.state,
      plan: cleared,
      slackDelivered: false,
    }),
    findings.state,
  );
  assert.deepEqual(
    finalizeSignupAgentReport({
      previous: findings.state,
      plan: cleared,
      slackDelivered: true,
    }),
    cleared.state,
  );
});

test("incomplete signup agent reviews cannot clear prior findings", () => {
  const findings = {
    ...initialSignupAgentReportState(),
    outcome: "findings" as const,
    findingCount: 1,
    reportComplete: true,
    runUrl: priorRunUrl,
  };
  for (const outcome of ["clean", "incomplete"] as const) {
    const plan = planSignupAgentReport({
      previous: findings,
      eventName: "schedule",
      outcome,
      findingCount: 0,
      reportComplete: false,
      runUrl,
    });
    assert.deepEqual(plan.state, findings);
    assert.equal(plan.recovery, null);
  }
});

test("undelivered signup agent findings are not saved as reported state", () => {
  const previous = initialSignupAgentReportState();
  const plan = planSignupAgentReport({
    previous,
    eventName: "schedule",
    outcome: "findings",
    findingCount: 2,
    reportComplete: true,
    runUrl,
  });

  assert.deepEqual(
    finalizeSignupAgentReport({ previous, plan, slackDelivered: false }),
    previous,
  );
});

test("clean review does not say it cleared findings from an incomplete report", () => {
  const previous = {
    ...initialSignupAgentReportState(),
    outcome: "findings" as const,
    findingCount: 2,
    reportComplete: false,
    runUrl: priorRunUrl,
    reportArtifactUrl: priorArtifactUrl,
  };
  const plan = planSignupAgentReport({
    previous,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    reportComplete: true,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });

  assert.equal(plan.recovery?.previousReportComplete, false);
  const message = renderSignupAgentRecovery({
    recovery: plan.recovery!,
    runUrl,
    reportArtifactUrl: artifactUrl,
  });
  assert.match(message, /found no current findings/);
  assert.match(message, /previous report was incomplete/);
  assert.doesNotMatch(message, /cleared 2 findings/);
});

test("signup agent state parsing rejects missing fields and unsafe links", () => {
  assert.throws(() => parseSignupAgentReportState("{}"), /invalid shape/);
  assert.throws(
    () =>
      parseSignupAgentReportState(
        JSON.stringify({
          ...initialSignupAgentReportState(),
          reportArtifactUrl: "https://evil.test/finding",
        }),
      ),
    /invalid shape/,
  );
});
