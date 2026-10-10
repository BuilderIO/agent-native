import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  initialSignupAgentReportState,
  initialSignupE2EReportState,
  legacySignupReportFallbackAllowed,
  legacySignupE2EOutcomeFromJobs,
  legacySignupE2ETestStepResult,
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

function workflowStepRun(workflow: string, name: string): string {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `workflow step ${name} exists`);
  const end = workflow.indexOf("\n      - ", start + 1);
  assert.notEqual(end, -1, `workflow step ${name} has a following step`);
  const step = workflow.slice(start, end);
  const runMarker = "        run: |\n";
  const runStart = step.indexOf(runMarker);
  assert.notEqual(runStart, -1, `workflow step ${name} has a shell script`);
  return step
    .slice(runStart + runMarker.length)
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}

test("legacy signup fallback is allowed only when continuity persistence was skipped", () => {
  assert.equal(
    legacySignupReportFallbackAllowed(
      JSON.stringify({
        jobs: [{ steps: [{ name: "Build report", conclusion: "success" }] }],
      }),
      "Persist Signup E2E continuity state",
    ),
    true,
  );

  assert.equal(
    legacySignupReportFallbackAllowed(
      JSON.stringify({
        jobs: [
          {
            steps: [
              {
                name: "Persist Signup agent continuity state",
                conclusion: "skipped",
              },
            ],
          },
        ],
      }),
      "Persist Signup agent continuity state",
    ),
    true,
  );

  for (const conclusion of ["success", "failure", "action_required"]) {
    assert.equal(
      legacySignupReportFallbackAllowed(
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
      false,
    );
  }

  assert.throws(
    () => legacySignupReportFallbackAllowed("{}", "Persist state"),
    /invalid shape/,
  );
});

test("Signup agent workflow invokes a supported continuity CLI command", () => {
  const workflow = readFileSync(
    ".github/workflows/signup-agent-scheduled.yml",
    "utf8",
  );
  const invocation = workflow.match(
    /node --experimental-strip-types scripts\/signup-report-continuity\.ts ([a-z-]+) \\\n\s+--jobs-file "[^"]+" \\\n\s+--persist-step-name "([^"]+)"/,
  );
  assert.ok(invocation, "workflow legacy fallback CLI invocation is present");

  const directory = mkdtempSync(join(tmpdir(), "signup-report-continuity-"));
  const jobsFile = join(directory, "jobs.json");
  writeFileSync(
    jobsFile,
    JSON.stringify({
      jobs: [
        {
          steps: [{ name: invocation[2], conclusion: "skipped" }],
        },
      ],
    }),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/signup-report-continuity.ts",
        invocation[1]!,
        "--jobs-file",
        jobsFile,
        "--persist-step-name",
        invocation[2]!,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "true");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Signup agent workflow requires explicit legacy fallback eligibility", () => {
  const workflow = readFileSync(
    ".github/workflows/signup-agent-scheduled.yml",
    "utf8",
  );
  assert.match(
    workflow,
    /if ! legacy_fallback_allowed="\$\(node --experimental-strip-types scripts\/signup-report-continuity\.ts legacy-fallback-allowed[\s\S]*?--persist-step-name "Persist Signup agent continuity state"\)"; then[\s\S]*?fi\s+if \[ "\$legacy_fallback_allowed" != "true" \]; then[\s\S]*?report_unknown_continuity[\s\S]*?fi\s+legacy_name=/,
  );
  assert.match(
    workflow,
    /report_unknown_continuity\(\) \{\s+message="\$1"\s+echo "::warning::\$message"\s+echo "\$message" >> "\$GITHUB_STEP_SUMMARY"\s+touch "\$unknown_state_file"\s+exit 0\s+\}/,
  );
  assert.match(
    workflow,
    /if \[ -z "\$legacy_name" \]; then\s+report_unknown_continuity "Previous Signup agent continuity is unknown because the explicitly allowed legacy report artifact was not found\.[^"]*"\s+fi/,
  );
  const restoreUnknownMarker =
    'if [ "$(jq -r \'.outcome // ""\' "$previous_state")" = "unknown" ]; then touch "$unknown_state_file"; fi';
  assert.equal(workflow.split(restoreUnknownMarker).length - 1, 2);
});

test("Signup agent scheduled lookup failures preserve unknown state and continue", () => {
  const workflow = readFileSync(
    ".github/workflows/signup-agent-scheduled.yml",
    "utf8",
  );
  assert.match(
    workflow,
    /if ! runs="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/actions\/workflows\/signup-agent-scheduled\.yml\/runs\?branch=main&event=schedule&status=completed&per_page=100"\)"; then[\s\S]*?report_unknown_continuity "Previous Signup agent continuity is unknown because scheduled runs could not be loaded\.[\s\S]*?\n\s+fi/,
  );
  assert.match(
    workflow,
    /if ! artifacts="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$previous_id\/artifacts\?per_page=100"\)"; then[\s\S]*?report_unknown_continuity[\s\S]*?\n\s+fi/,
  );
  assert.match(
    workflow,
    /if ! gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$previous_id\/jobs\?per_page=100" > "\$previous_jobs_file"; then[\s\S]*?report_unknown_continuity[\s\S]*?\n\s+fi/,
  );
  assert.match(
    workflow,
    /if \[ -f \.tmp\/signup-agent-continuity\/previous\/continuity-unknown \]; then\s+continuity_unknown=true\s+fi\s+args\+=\(--continuity-unknown "\$continuity_unknown"\)/,
  );
});

test("unknown Signup agent continuity is reported and retained until Slack delivery", () => {
  const workflow = readFileSync(
    ".github/workflows/signup-agent-scheduled.yml",
    "utf8",
  );
  assert.match(
    workflow,
    /name: Build the consolidated Slack report\n        id: report/,
  );
  assert.match(
    workflow,
    /if \[ -f \.tmp\/signup-agent-continuity\/previous\/continuity-unknown \]; then\s+continuity_unknown=true\s+fi\s+args\+=\(--continuity-unknown "\$continuity_unknown"\)\s+echo "continuity_unknown=\$continuity_unknown" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    workflow,
    /steps\.report\.outputs\.continuity_unknown == 'true'/,
  );
  assert.match(
    workflow,
    /if \[ "\$\{\{ steps\.report\.outputs\.continuity_unknown \}\}" != "true" \] && \[ "\$\{\{ steps\.continuity-plan\.outputs\.recovered \}\}" != "true" \] && \[ "\$\{\{ steps\.publish\.outputs\.has_findings \}\}" != "true" \]; then delivered=true; fi/,
  );
});

test("an unknown Signup agent baseline advances only after Slack delivery", () => {
  const previous = initialSignupAgentReportState();
  const plan = planSignupAgentReport({
    previous,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    reportComplete: true,
    runUrl,
  });

  assert.equal(plan.state.outcome, "clean");
  assert.deepEqual(
    finalizeSignupAgentReport({ previous, plan, slackDelivered: false }),
    previous,
  );
  assert.deepEqual(
    finalizeSignupAgentReport({ previous, plan, slackDelivered: true }),
    plan.state,
  );
});

test("a scheduled-run API failure keeps continuity unknown and succeeds", () => {
  const workflow = readFileSync(
    ".github/workflows/signup-agent-scheduled.yml",
    "utf8",
  );
  const restoreScript = workflowStepRun(
    workflow,
    "Restore the previous scheduled report state",
  );
  const directory = mkdtempSync(join(tmpdir(), "signup-agent-continuity-"));
  const scriptsDirectory = join(directory, "scripts");
  const binDirectory = join(directory, "bin");
  mkdirSync(scriptsDirectory);
  mkdirSync(binDirectory);
  copyFileSync(
    "scripts/signup-report-continuity.ts",
    join(scriptsDirectory, "signup-report-continuity.ts"),
  );

  const restorePath = join(directory, "restore.sh");
  const ghPath = join(binDirectory, "gh");
  const callsPath = join(directory, "gh-calls.txt");
  const outputPath = join(directory, "github-output.txt");
  const summaryPath = join(directory, "step-summary.md");
  writeFileSync(restorePath, restoreScript);
  writeFileSync(
    ghPath,
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$GH_CALLS"\nexit 1\n',
  );
  chmodSync(ghPath, 0o755);

  try {
    const result = spawnSync("bash", [restorePath], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "123",
        GITHUB_REPOSITORY: "BuilderIO/agent-native",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        GH_CALLS: callsPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(summaryPath, "utf8"),
      /continuity is unknown because scheduled runs could not be loaded/,
    );
    assert.equal(
      readFileSync(
        join(
          directory,
          ".tmp/signup-agent-continuity/previous/continuity-unknown",
        ),
        "utf8",
      ),
      "",
    );
    assert.equal(
      readFileSync(
        join(directory, ".tmp/signup-agent-continuity/previous/state.json"),
        "utf8",
      ),
      `${JSON.stringify(initialSignupAgentReportState(), null, 2)}\n`,
    );
    assert.equal(
      readFileSync(callsPath, "utf8"),
      "api repos/BuilderIO/agent-native/actions/workflows/signup-agent-scheduled.yml/runs?branch=main&event=schedule&status=completed&per_page=100\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy E2E recovery uses the signup test step result only", () => {
  const reportJobFailure = JSON.stringify({
    jobs: [
      {
        name: "Full signup flow / Signup canary",
        conclusion: "success",
        steps: [{ name: "Run full signup flow", conclusion: "success" }],
      },
      {
        name: "Report signup E2E status",
        conclusion: "failure",
        steps: [{ name: "Post report", conclusion: "failure" }],
      },
    ],
  });
  assert.equal(legacySignupE2ETestStepResult(reportJobFailure), "success");
  assert.equal(
    legacySignupE2EOutcomeFromJobs(reportJobFailure, {
      available: true,
      inconclusive: false,
    }),
    "clean",
  );

  for (const evidence of [
    { available: false, inconclusive: false },
    { available: true, inconclusive: true },
  ]) {
    assert.equal(
      legacySignupE2EOutcomeFromJobs(reportJobFailure, evidence),
      "unknown",
    );
  }

  const signupTestFailure = JSON.stringify({
    jobs: [
      {
        name: "Full signup flow / Signup canary",
        conclusion: "failure",
        steps: [{ name: "Run full signup flow", conclusion: "failure" }],
      },
      {
        name: "Report signup E2E status",
        conclusion: "success",
        steps: [{ name: "Post report", conclusion: "success" }],
      },
    ],
  });
  assert.equal(
    legacySignupE2EOutcomeFromJobs(signupTestFailure, {
      available: false,
      inconclusive: true,
    }),
    "failure",
  );

  assert.equal(
    legacySignupE2EOutcomeFromJobs(
      JSON.stringify({
        jobs: [
          {
            name: "Full signup flow / Signup canary",
            conclusion: "failure",
            steps: [{ name: "Typecheck signup suite", conclusion: "failure" }],
          },
        ],
      }),
      { available: true, inconclusive: false },
    ),
    "unknown",
  );

  assert.equal(
    legacySignupE2EOutcomeFromJobs(
      JSON.stringify({
        jobs: [
          {
            name: "Full signup flow / Signup canary",
            conclusion: "cancelled",
            steps: [{ name: "Run full signup flow", conclusion: "cancelled" }],
          },
        ],
      }),
      { available: true, inconclusive: false },
    ),
    "unknown",
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

test("signup E2E preserves unknown continuity until its Slack warning is delivered", () => {
  const previous = initialSignupE2EReportState();
  const clean = planSignupE2EReport({
    previous,
    eventName: "schedule",
    outcome: "clean",
    findingCount: 0,
    runUrl,
  });

  assert.deepEqual(
    finalizeSignupE2EReport({
      previous,
      plan: clean,
      slackDelivered: false,
      requireSlackDelivery: true,
    }),
    previous,
  );
  assert.equal(
    finalizeSignupE2EReport({
      previous,
      plan: clean,
      slackDelivered: true,
      requireSlackDelivery: true,
    }).outcome,
    "clean",
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
